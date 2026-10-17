import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  CANARY_INTERVAL_MINUTES,
  GENERAL_RATE_LIMIT,
  GUESSABLE_INPUT_PATHS,
  HEALTH_PATH
} from "../../lib/edge/edge-stack";
import { dev, devWithEdge, prod } from "./helpers/synth";

function stackOf(stage: typeof dev, id: string): Stack {
  const child = stage.node.findChild(id);
  if (!Stack.isStack(child)) throw new Error(`${id} is not a Stack`);
  return child;
}

describe("Development without the edge stack", () => {
  it("has no Edge stack until AWS verifies the account for CloudFront", () => {
    expect(dev.node.tryFindChild("Edge")).toBeUndefined();
  });
});

describe.each([
  ["dev with edge", devWithEdge],
  ["prod", prod]
] as const)("Edge on the CloudFront Free plan (%s; ADR-0004, ADR-0009 amendments)", (_name, stage) => {
  const edge = stackOf(stage, "Edge");
  const template = Template.fromStack(edge);
  const api = Template.fromStack(stackOf(stage, "Api"));

  it("is deployed in us-east-1, the only Region with CLOUDFRONT-scope web ACLs", () => {
    expect(edge.region).toBe("us-east-1");
  });

  it("puts a CLOUDFRONT web ACL with exactly five rules in front of the distribution", () => {
    const acl = Object.values(template.findResources("AWS::WAFv2::WebACL"));
    expect(acl).toHaveLength(1);
    expect(acl[0].Properties.Scope).toBe("CLOUDFRONT");
    // The Free plan allows five rules and no rule groups of our own.
    expect(acl[0].Properties.Rules).toHaveLength(5);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ WebACLId: { "Fn::GetAtt": [Match.anyValue(), "Arn"] } })
    });
  });

  it("rate-limits every client, and the guessable-input paths more strictly (#124)", () => {
    const rules = Object.values(template.findResources("AWS::WAFv2::WebACL"))[0].Properties.Rules as Array<{
      Name: string;
      Statement: { RateBasedStatement?: { Limit: number; ScopeDownStatement?: unknown } };
    }>;
    const all = rules.find((r) => r.Name === "RateLimitAll")?.Statement.RateBasedStatement;
    const auth = rules.find((r) => r.Name === "RateLimitAuth")?.Statement.RateBasedStatement;
    expect(all?.Limit).toBe(GENERAL_RATE_LIMIT);
    expect(auth?.Limit).toBe(AUTH_RATE_LIMIT);
    const scope = JSON.stringify(auth?.ScopeDownStatement);
    for (const path of GUESSABLE_INPUT_PATHS) {
      expect(scope).toContain(`"SearchString":"${path}"`);
      expect(scope).toContain(`"SearchString":"${path}/"`);
    }
    expect(scope).toContain('"PositionalConstraint":"EXACTLY"');
    // The API routes ignore case (#180): every match lowercases the path first, so /API/v1/Join is limited too.
    expect(scope).not.toContain('"Type":"NONE"');
    expect(scope.match(/"Type":"LOWERCASE"/g)).toHaveLength(GUESSABLE_INPUT_PATHS.length * 2);
    // ... and URL-decodes it before that (#208), so /api/v1/%6Aoin is limited as /api/v1/join.
    const decodeThenLowercase = /\{"Priority":0,"Type":"URL_DECODE"\},\{"Priority":1,"Type":"LOWERCASE"\}/g;
    expect(scope.match(decodeThenLowercase)).toHaveLength(GUESSABLE_INPUT_PATHS.length * 2);
    expect(scope).not.toContain("/api/v1/auth/");
  });

  it("subscribes the distribution and the web ACL to the FREE plan tier", () => {
    const plans = Object.values(template.findResources("AWS::PricingPlanManager::Subscription"));
    expect(plans).toHaveLength(1);
    expect(plans[0].Properties).toMatchObject({ PlanFamily: "CloudFront", PlanTier: "FREE" });
    const covered = (plans[0].Properties.ResourceArns as Array<Record<string, unknown>>).map((arn) => JSON.stringify(arn));
    const distributionId = Object.keys(template.findResources("AWS::CloudFront::Distribution"))[0];
    const aclId = Object.keys(template.findResources("AWS::WAFv2::WebACL"))[0];
    expect(covered.some((arn) => arn.includes(distributionId))).toBe(true);
    expect(covered.some((arn) => arn.includes(aclId))).toBe(true);
  });

  it("uses only managed cache, origin request and response header policies, which the Free plan requires", () => {
    template.resourceCountIs("AWS::CloudFront::CachePolicy", 0);
    template.resourceCountIs("AWS::CloudFront::OriginRequestPolicy", 0);
    template.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 0);
  });

  it("serves the apps with the managed security headers and a Content-Security-Policy function (#133)", () => {
    const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0];
    const app = distribution.Properties.DistributionConfig.DefaultCacheBehavior;
    // Managed SecurityHeadersPolicy.
    expect(app.ResponseHeadersPolicyId).toBe("67f7725c-6f97-4210-82d7-5512b31e9d03");
    expect(app.FunctionAssociations).toHaveLength(1);
    expect(app.FunctionAssociations[0].EventType).toBe("viewer-response");
    const functions = Object.values(template.findResources("AWS::CloudFront::Function"));
    expect(functions).toHaveLength(1);
    const code = functions[0].Properties.FunctionCode as string;
    expect(code).toContain("content-security-policy");
    expect(code).toContain("script-src 'self'");
    expect(code).toContain("frame-ancestors 'none'");
    // The service worker and the manifest are same-origin (#124 item 10, K2's CSP review on #232).
    expect(code).toContain("worker-src 'self'");
    expect(code).toContain("manifest-src 'self'");
    expect(code).toContain("https://cognito-idp.");
    expect(code).not.toContain("unsafe-eval");
  });

  it("sends /api/* uncached to the API Function URL through a signing origin access control", () => {
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: "lambda", SigningBehavior: "always" })
    });
    const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0];
    const apiBehavior = distribution.Properties.DistributionConfig.CacheBehaviors.find(
      (b: { PathPattern: string }) => b.PathPattern === "/api/*"
    );
    expect(apiBehavior.ViewerProtocolPolicy).toBe("https-only");
    // Managed CachingDisabled policy.
    expect(apiBehavior.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  });

  it("keeps the PWA bucket private", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  it("gives the API function an IAM-authenticated Function URL that only this account's distributions may invoke", () => {
    api.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
    for (const action of ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]) {
      api.hasResourceProperties("AWS::Lambda::Permission", {
        Action: action,
        Principal: "cloudfront.amazonaws.com",
        SourceArn: Match.anyValue()
      });
    }
  });

  it("runs a canary every five minutes that calls the health endpoint through CloudFront", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: `rate(${CANARY_INTERVAL_MINUTES} minutes)`,
      Target: Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 0 } })
    });
    const canary = Object.values(template.findResources("AWS::Lambda::Function")).find((fn) =>
      JSON.stringify(fn.Properties.Environment ?? {}).includes(HEALTH_PATH)
    );
    expect(canary).toBeDefined();
    expect(JSON.stringify(canary?.Properties.Environment.Variables.HEALTH_URL)).toContain("DomainName");
    template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", { MaximumRetryAttempts: 0 });
  });
});

describe("Edge alarms (ADR-0012 amendment)", () => {
  it("production alarms on CloudFront 5xx and canary failure and notifies a topic in us-east-1", () => {
    const template = Template.fromStack(stackOf(prod, "Edge"));
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { Namespace: "AWS/CloudFront", MetricName: "5xxErrorRate" });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "Errors", TreatMissingData: "breaching" });
    template.resourceCountIs("AWS::SNS::Topic", 1);
  });

  it("development has the canary but no alarms", () => {
    const template = Template.fromStack(stackOf(devWithEdge, "Edge"));
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });
});
