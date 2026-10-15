import { CfnOutput, CfnResource, Duration, RemovalPolicy, Stack, StackProps, Validations } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  FunctionCode,
  FunctionEventType,
  Function as CloudFrontFunction,
  FunctionRuntime,
  FunctionUrlOriginAccessControl,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  Signing,
  ViewerProtocolPolicy
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Architecture, Code, Function as LambdaFunction, LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { createLogGroup } from "../constructs/log-group-defaults";
import { applyStandardTags } from "../constructs/tagging";

/**
 * The web apps' Content-Security-Policy (#133). The API is same-origin (/api/*); sign-in exchanges the code at the
 * Cognito domain, two-step sign-in setup calls the Cognito user API (#127), and the design system loads Heebo and
 * IBM Plex Mono from Google Fonts. Inline style attributes are allowed (React's `style`); inline scripts are not.
 */
export function appContentSecurityPolicy(config: TempoEnvironmentConfig): string {
  const cognitoDomain = `https://tempo-${config.environmentName}-${config.accountId}.auth.${config.region}.amazoncognito.com`;
  const cognitoApi = `https://cognito-idp.${config.region}.amazonaws.com`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${cognitoDomain} ${cognitoApi}`,
    `form-action 'self' ${cognitoDomain}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}

function cspFunctionSource(policy: string): string {
  return [
    "function handler(event) {",
    "  var response = event.response;",
    `  response.headers["content-security-policy"] = { value: ${JSON.stringify(policy)} };`,
    "  return response;",
    "}"
  ].join("\n");
}

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
/** What the canary calls through CloudFront (ADR-0012 amendment). */
export const HEALTH_PATH = "/api/v1/health";
export const CANARY_INTERVAL_MINUTES = 5;
/** CloudFront 5xxErrorRate, in percent, that raises the alarm. */
export const CLOUDFRONT_5XX_RATE_THRESHOLD = 5;

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

    // The Free plan allows managed response header policies and CloudFront Functions, but no custom response
    // header policy, so the Content-Security-Policy comes from a viewer-response function (#133) and the other
    // security headers (HSTS, nosniff, frame options, referrer policy) from the managed SecurityHeadersPolicy.
    const contentSecurityPolicy = new CloudFrontFunction(this, "ContentSecurityPolicy", {
      functionName: resourceName(config, "csp"),
      comment: "Adds the apps' Content-Security-Policy (docs: issue #133)",
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(cspFunctionSource(appContentSecurityPolicy(config)))
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
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [{ function: contentSecurityPolicy, eventType: FunctionEventType.VIEWER_RESPONSE }],
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

    const canary = this.addCanary(config);
    if (config.observability.alarmsEnabled) {
      this.addAlarms(config, canary);
    }

    applyStandardTags(this, config, "edge");
  }

  /**
   * The canary (ADR-0012 amendment): every five minutes EventBridge
   * Scheduler invokes a small function that calls the health endpoint
   * through CloudFront and logs the result. A failed check throws, so the
   * failure shows in the function's Errors metric. Each check also reaches
   * the API function and keeps one instance warm. It lives here, next to the
   * distribution, so it needs no cross-region reference. Development runs
   * it too; its failures stay in the log, without an alarm.
   */
  private addCanary(config: TempoEnvironmentConfig): LambdaFunction {
    const functionName = resourceName(config, "canary");
    const canary = new LambdaFunction(this, "CanaryFunction", {
      functionName,
      description: "Calls the API health endpoint through CloudFront and logs the result",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(15),
      // A failed check is reported, not retried: the next run is five minutes away.
      retryAttempts: 0,
      loggingFormat: LoggingFormat.JSON,
      logGroup: createLogGroup(this, "CanaryLogGroup", config, { logGroupName: `/aws/lambda/${functionName}` }),
      environment: { HEALTH_URL: `https://${this.distribution.distributionDomainName}${HEALTH_PATH}` },
      handler: "index.handler",
      code: Code.fromInline(CANARY_SOURCE)
    });

    new Schedule(this, "CanarySchedule", {
      scheduleName: resourceName(config, "canary"),
      description: "Runs the canary (ADR-0012 amendment)",
      schedule: ScheduleExpression.rate(Duration.minutes(CANARY_INTERVAL_MINUTES)),
      target: new LambdaInvoke(canary, { retryAttempts: 0 })
    });

    return canary;
  }

  /**
   * Two of production's ten alarms (ADR-0012 amendment). CloudFront
   * publishes its metrics only in us-east-1, and an alarm can notify only a
   * topic in its own Region, so this stack has its own alarm topic.
   */
  private addAlarms(config: TempoEnvironmentConfig, canary: LambdaFunction): void {
    const cloudFront5xx = new Alarm(this, "CloudFront5xxRateAlarm", {
      alarmName: resourceName(config, "cloudfront-5xx-rate"),
      alarmDescription: `More than ${CLOUDFRONT_5XX_RATE_THRESHOLD}% of CloudFront responses are server errors`,
      metric: new Metric({
        namespace: "AWS/CloudFront",
        metricName: "5xxErrorRate",
        dimensionsMap: { DistributionId: this.distribution.distributionId, Region: "Global" },
        statistic: "Average",
        period: Duration.minutes(5)
      }),
      threshold: CLOUDFRONT_5XX_RATE_THRESHOLD,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING
    });

    // Two failed checks in a row. A canary that stops running is a failure too.
    const canaryFailure = new Alarm(this, "CanaryFailureAlarm", {
      alarmName: resourceName(config, "canary-failure"),
      alarmDescription: "The health check through CloudFront failed twice in a row",
      metric: canary.metricErrors({ period: Duration.minutes(CANARY_INTERVAL_MINUTES), statistic: "Sum" }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING
    });

    if (config.observability.alarmNotificationsEnabled && config.observability.alarmEmail) {
      const topic = new Topic(this, "AlarmTopic", { topicName: resourceName(config, "edge-alarms") });
      topic.addSubscription(new EmailSubscription(config.observability.alarmEmail));
      for (const alarm of [cloudFront5xx, canaryFailure]) {
        alarm.addAlarmAction(new SnsAction(topic));
      }
    }
  }
}

const CANARY_SOURCE = `
exports.handler = async () => {
  const started = Date.now();
  const response = await fetch(process.env.HEALTH_URL, { signal: AbortSignal.timeout(10000) });
  console.log(JSON.stringify({ check: "health", status: response.status, durationMs: Date.now() - started }));
  if (!response.ok) throw new Error("Health check returned " + response.status);
};
`;

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
