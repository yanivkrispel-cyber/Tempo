import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev, prod } from "./helpers/synth";

function stackTemplate(childId: string) {
  const child = dev.node.findChild(childId);
  if (!Stack.isStack(child)) throw new Error(`${childId} is not a Stack`);
  return Template.fromStack(child);
}

describe("API Gateway is an HTTP API, never a REST API (ADR-0004)", () => {
  const template = stackTemplate("Api");

  it("creates exactly one ApiGatewayV2 HTTP API", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", { ProtocolType: "HTTP" });
  });

  it("never creates an API Gateway REST API resource", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 0);
  });

  it("declares GET /api/v1/health as a route", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: "GET /api/v1/health" });
  });

  it("declares GET /api/v1/me protected by a JWT authorizer", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /api/v1/me",
      AuthorizationType: "JWT"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
  });

  it("CORS lets the apps send If-Match and read Location and Retry-After", () => {
    const [api] = Object.values(template.findResources("AWS::ApiGatewayV2::Api"));
    expect(api.Properties.CorsConfiguration.AllowHeaders).toContain("If-Match");
    expect(api.Properties.CorsConfiguration.ExposeHeaders).toEqual(expect.arrayContaining(["Location", "Retry-After"]));
  });

  it("CORS has no wildcard origin combined with credentials", () => {
    const apis = template.findResources("AWS::ApiGatewayV2::Api");
    const [api] = Object.values(apis);
    const cors = api.Properties.CorsConfiguration;

    if (cors.AllowOrigins?.includes("*")) {
      expect(cors.AllowCredentials).not.toBe(true);
    }
  });

  it("has access logging configured with an explicit destination and format", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue()
      })
    });
  });
});

describe("The public routes have their own, lower throttle (board #404, S-A)", () => {
  const template = stackTemplate("Api");
  const stage = () => Object.values(template.findResources("AWS::ApiGatewayV2::Stage"))[0].Properties;

  it("routes public reads and the public join on their own route keys, to the same function, without an authorizer", () => {
    for (const key of ["GET /api/v1/public/{proxy+}", "POST /api/v1/public/studios/{slug}/join"]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: key, AuthorizationType: "NONE" });
    }
  });

  it("throttles them below the stage default of 50 and 100, from the environment config", () => {
    expect(stage().DefaultRouteSettings).toMatchObject({ ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 });
    expect(stage().RouteSettings).toEqual({
      "GET /api/v1/public/{proxy+}": { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 12 },
      "POST /api/v1/public/studios/{slug}/join": { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 4 }
    });
  });

  it("deploys the stage after the routes its settings name", () => {
    const [stageId] = Object.keys(template.findResources("AWS::ApiGatewayV2::Stage"));
    const dependsOn = [template.toJSON().Resources[stageId].DependsOn ?? []].flat() as string[];
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    const throttled = Object.entries(routes)
      .filter(([, r]) => (r.Properties.RouteKey as string).includes("/public/"))
      .map(([id]) => id);
    expect(throttled).toHaveLength(2);
    expect(dependsOn).toEqual(expect.arrayContaining(throttled));
  });

  it("adds no resource that bills by itself: no WAF, no usage plan (N-4)", () => {
    template.resourceCountIs("AWS::WAFv2::WebACL", 0);
    template.resourceCountIs("AWS::ApiGateway::UsagePlan", 0);
  });
});

describe("The API validates Cognito access tokens itself (ADR-0004 amendment)", () => {
  const template = stackTemplate("Api");

  it("passes the user pool issuer and the accepted app clients to the API function", () => {
    const functions = Object.values(template.findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.FunctionName === "tempo-dev-api"
    );
    expect(functions).toHaveLength(1);
    const variables = functions[0].Properties.Environment.Variables;

    expect(JSON.stringify(variables.COGNITO_ISSUER)).toContain("https://");
    expect(JSON.stringify(variables.COGNITO_ISSUER)).toContain("ProviderName");
    expect(JSON.stringify(variables.COGNITO_CLIENT_IDS)).toContain("Fn::Join");
  });

  it("allows the X-Tempo-Authorization header in CORS", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({ AllowHeaders: Match.arrayWith(["X-Tempo-Authorization"]) })
    });
  });
});

describe("Phase 1 routes and database access (docs/26)", () => {
  const template = stackTemplate("Api");

  it("sends every other /api/v1 route to the function without a gateway authorizer", () => {
    // The API validates both pools' tokens itself; the gateway authorizer
    // knows only the customer pool and would refuse operator tokens.
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: `${method} /api/v1/{proxy+}`,
        AuthorizationType: "NONE"
      });
    }
  });

  it("leaves CORS preflights to the gateway: no ANY or OPTIONS route", () => {
    // ANY includes OPTIONS, so a preflight would reach the function and get 405 (#60, 2026-10-15).
    const routeKeys = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
      (route) => route.Properties.RouteKey as string
    );
    expect(routeKeys.filter((key) => key.startsWith("ANY ") || key.startsWith("OPTIONS "))).toEqual([]);
  });

  it("tells the API where Neon's pooled endpoint is and which password parameters to read", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "tempo-dev-api",
      Environment: {
        Variables: Match.objectLike({
          DATABASE_HOST: Match.stringLikeRegexp("^ep-.+-pooler\..+\.neon\.tech$"),
          DATABASE_NAME: "neondb",
          DATABASE_APP_PASSWORD_PARAMETER: "/tempo/dev/db/app-password",
          DATABASE_PLATFORM_PASSWORD_PARAMETER: "/tempo/dev/db/platform-password",
          ADMIN_APP_URL: "https://tempo-studio-console.pages.dev",
          CLIENT_APP_URL: "https://tempo-members.pages.dev"
        })
      }
    });
  });

  it("the API may read only the two runtime passwords, never the owner URL or the migrator's", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) => p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>
    );
    const resources = JSON.stringify(
      statements.filter((s) => [s.Action].flat().some((a) => a.startsWith("ssm:"))).map((s) => s.Resource)
    );
    expect(resources).toContain("parameter/tempo/dev/db/app-password");
    expect(resources).toContain("parameter/tempo/dev/db/platform-password");
    expect(resources).not.toContain("neon-connection-string");
    expect(resources).not.toContain("migrator-password");
    expect(resources).not.toContain("*");
  });
});

describe("The 10-studio tripwire (docs/26 section 10.2)", () => {
  const messaging = stackTemplate("Messaging");

  it("sends a daily tripwire.check message to the work queue through Scheduler's universal SQS target", () => {
    const schedules = Object.values(messaging.findResources("AWS::Scheduler::Schedule"));
    const tripwire = schedules.find((s) => s.Properties.Name === "tempo-dev-tripwire");
    expect(tripwire).toBeDefined();
    expect(tripwire!.Properties.ScheduleExpression).toBe("cron(0 6 * * ? *)");
    expect(tripwire!.Properties.Target.Arn).toBe("arn:aws:scheduler:::aws-sdk:sqs:sendMessage");
    expect(JSON.stringify(tripwire!.Properties.Target.Input)).toContain("tripwire.check");
  });

  it("gives the worker the platform role's password parameter and no alarm topic in dev", () => {
    messaging.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "tempo-dev-worker-outbox",
      Environment: {
        Variables: Match.objectLike({
          DATABASE_PLATFORM_PASSWORD_PARAMETER: "/tempo/dev/db/platform-password",
          DATABASE_NAME: "neondb"
        })
      }
    });
    const [worker] = Object.values(
      messaging.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "tempo-dev-worker-outbox" } })
    );
    expect(worker.Properties.Environment.Variables.ALARM_TOPIC_ARN).toBeUndefined();
    expect(JSON.stringify(messaging.toJSON())).not.toContain("sns:Publish");
  });
});

describe("The tripwire alerts the owner in production only", () => {
  const child = prod.node.findChild("Messaging");
  if (!Stack.isStack(child)) throw new Error("Messaging is not a Stack");
  const messaging = Template.fromStack(child);

  it("the prod worker may publish to the existing alarm topic, and only to it", () => {
    const [worker] = Object.values(
      messaging.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "tempo-prod-worker-outbox" } })
    );
    expect(JSON.stringify(worker.Properties.Environment.Variables.ALARM_TOPIC_ARN)).toContain("tempo-prod-alarms");

    const publish = Object.values(messaging.findResources("AWS::IAM::Policy"))
      .flatMap((p) => p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>)
      .filter((s) => [s.Action].flat().includes("sns:Publish"));
    expect(publish).toHaveLength(1);
    expect(JSON.stringify(publish[0].Resource)).toContain("tempo-prod-alarms");
  });
});

describe("the media bucket takes browser uploads only from the apps (docs/33 section 6, #345)", () => {
  const template = stackTemplate("Api");

  it("CORS allows the presigned POST and, for the story canvas, the presigned GET, from the app origins only", () => {
    const [bucket] = Object.values(template.findResources("AWS::S3::Bucket", { Properties: { CorsConfiguration: Match.anyValue() } }));
    const rules = bucket.Properties.CorsConfiguration.CorsRules as Array<{ AllowedMethods: string[]; AllowedOrigins: string[]; AllowedHeaders?: string[] }>;
    expect(rules.map((rule) => rule.AllowedMethods)).toEqual([["POST"], ["GET"]]);
    for (const rule of rules) {
      expect(rule.AllowedOrigins.length).toBeGreaterThan(0);
      expect(rule.AllowedOrigins).not.toContain("*");
    }
    // The GET rule takes the same origins as uploads and no request headers (docs/37 section 7.3, MK5).
    expect(rules[1].AllowedOrigins).toEqual(rules[0].AllowedOrigins);
    expect(rules[1].AllowedHeaders).toBeUndefined();
  });
});
