import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

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
