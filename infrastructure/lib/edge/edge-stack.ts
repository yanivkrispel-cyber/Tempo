import { CfnOutput, CfnResource, RemovalPolicy, Stack, StackProps, Validations } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  FunctionUrlOriginAccessControl,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  Signing,
  ViewerProtocolPolicy
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface EdgeStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  /** Domain of the API function's Function URL, e.g. `abc123.lambda-url.eu-central-1.on.aws`. */
  readonly apiFunctionUrlDomain: string;
}

/** Requests per client IP in five minutes before WAF blocks it: all paths (rule 4). */
export const GENERAL_RATE_LIMIT = 2000;
/** The stricter limit on authentication endpoints (rule 5). */
export const AUTH_RATE_LIMIT = 100;
export const AUTH_PATH_PREFIX = "/api/v1/auth/";

/**
 * The edge (ADR-0004 and ADR-0009 amendments): one CloudFront distribution
 * serves the PWA and, under `/api/*`, the API function's Function URL. A WAF
 * web ACL with five rules sits in front of it. The CloudFront flat-rate Free
 * plan covers the distribution, the web ACL and its rules at $0.
 *
 * The stack is deployed in us-east-1, the only Region with CLOUDFRONT-scope
 * web ACLs. The API function stays in the main Region. Its Function URL
 * domain reaches this stack through a weak cross-region reference
 * (Fn::GetStackOutput), which only this stack opts into. CDK skips a stack
 * whose template did not change, so if the API function or its URL is ever
 * replaced, deploy this stack again. The smoke test through CloudFront fails
 * until then.
 */
export class EdgeStack extends Stack {
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    // The flag is read from the consuming stack. Main-Region stacks keep the
    // strong references that cdk.json sets.
    this.node.setContext("@aws-cdk/core:defaultCrossStackReferences", "weak");
    const { config } = props;

    const webAcl = new CfnWebACL(this, "WebAcl", {
      name: resourceName(config, "edge-web-acl"),
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: visibility("tempo-edge"),
      // The Free plan allows five rules and no rule groups of our own.
      rules: [
        managedRuleGroup("AWSManagedRulesCommonRuleSet", 0),
        managedRuleGroup("AWSManagedRulesKnownBadInputsRuleSet", 1),
        managedRuleGroup("AWSManagedRulesAmazonIpReputationList", 2),
        {
          name: "RateLimitAll",
          priority: 3,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: GENERAL_RATE_LIMIT, aggregateKeyType: "IP" } },
          visibilityConfig: visibility("RateLimitAll")
        },
        {
          name: "RateLimitAuth",
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: AUTH_RATE_LIMIT,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                byteMatchStatement: {
                  searchString: AUTH_PATH_PREFIX,
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  textTransformations: [{ priority: 0, type: "NONE" }]
                }
              }
            }
          },
          visibilityConfig: visibility("RateLimitAuth")
        }
      ]
    });

    // Static PWA files only, no personal data, so the bucket can live here
    // next to the distribution instead of in the main Region.
    const pwaBucket = new Bucket(this, "PwaBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    // Signs every request to the Function URL (AuthType AWS_IAM), so the URL
    // cannot be called directly. The invoke permissions live in the API stack,
    // because a Lambda permission must be in the function's Region.
    const apiOriginAccessControl = new FunctionUrlOriginAccessControl(this, "ApiOriginAccessControl", {
      originAccessControlName: resourceName(config, "api-oac"),
      signing: Signing.SIGV4_ALWAYS
    });

    // Only managed cache and origin request policies: the Free plan allows no others.
    this.distribution = new Distribution(this, "Distribution", {
      comment: `Tempo ${config.environmentName}: PWA and API`,
      webAclId: webAcl.attrArn,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(pwaBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new HttpOrigin(props.apiFunctionUrlDomain, {
            protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
            originAccessControlId: apiOriginAccessControl.originAccessControlId
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
        }
      }
    });

    // No CDK construct yet. FREE activates at once; a paid tier would wait in
    // PENDING_APPROVAL and bill nothing until someone approves it.
    const freePlan = new CfnResource(this, "FreePlanSubscription", {
      type: "AWS::PricingPlanManager::Subscription",
      properties: {
        PlanFamily: "CloudFront",
        PlanTier: "FREE",
        UsageLevel: "DEFAULT",
        ResourceArns: [this.distribution.distributionArn, webAcl.attrArn]
      }
    });

    // The resource type is documented in the CloudFormation template reference,
    // but the resource spec bundled with aws-cdk-lib 2.262 predates it. CDK
    // applies the acknowledgement app-wide; this is the only CfnResource here.
    Validations.of(freePlan).acknowledge({
      id: "CloudFormation-Validate::F3006",
      reason: "AWS::PricingPlanManager::Subscription exists in CloudFormation but not yet in the bundled resource spec"
    });

    new CfnOutput(this, "DistributionDomainName", {
      description: "The PWA and, under /api/*, the API - read by the deployment smoke test",
      value: this.distribution.distributionDomainName
    });
    new CfnOutput(this, "PwaBucketName", {
      description: "Where the PWA build is uploaded",
      value: pwaBucket.bucketName
    });
    new CfnOutput(this, "FreePlanStatus", {
      description: "ACTIVE once the Free plan covers the distribution and the web ACL",
      value: freePlan.getAtt("Status").toString()
    });

    applyStandardTags(this, config, "edge");
  }
}

/** WAF metrics and sampled requests are free; request logs are not on the Free plan. */
function visibility(metricName: string): CfnWebACL.VisibilityConfigProperty {
  return { cloudWatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName };
}

function managedRuleGroup(name: string, priority: number): CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: { managedRuleGroupStatement: { vendorName: "AWS", name } },
    visibilityConfig: visibility(name)
  };
}
