import { CfnOutput, Duration, Fn, Stack, StackProps } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpStage,
  LogGroupLogDestination
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IUserPool, IUserPoolClient } from "aws-cdk-lib/aws-cognito";
import { CfnPermission, FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { createLogGroup } from "../constructs/log-group-defaults";
import { TempoFunction } from "../constructs/lambda-defaults";
import { applyStandardTags } from "../constructs/tagging";

export interface ApiStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly userPool: IUserPool;
  readonly userPoolClients: IUserPoolClient[];
  /** Git commit SHA (or "local"), surfaced by the health endpoint's `version` field. */
  readonly buildVersion: string;
}

const ACCESS_LOG_FORMAT = AccessLogFormat.custom(
  JSON.stringify({
    requestId: "$context.requestId",
    routeKey: "$context.routeKey",
    status: "$context.status",
    responseLatency: "$context.responseLatency",
    integrationLatency: "$context.integrationLatency",
    sourceIp: "$context.identity.sourceIp",
    userAgent: "$context.identity.userAgent",
    authorizerPrincipal: "$context.authorizer.principalId",
    errorMessage: "$context.error.message"
  })
);

/**
 * API Gateway HTTP API + the Tempo.Api Lambda (ADR-0004, ADR-0002). This
 * phase only requires GET /api/v1/health (public) plus the minimum
 * technical plumbing to prove Cognito JWT authentication end to end
 * (GET /api/v1/me, protected) - both are needed to satisfy the required
 * smoke tests in LLD section 38 ("Cognito token can call an authenticated
 * test endpoint", "Unauthenticated request receives 401").
 *
 * No Tempo function runs in a VPC (ADR-0022: the database is Neon over a
 * public TLS endpoint). Neither route touches the database yet, so the API
 * function has no database parameter access; it gets read access to its own
 * runtime credential when the first route needs it.
 */
export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;
  public readonly apiFunction: TempoFunction;
  /** Domain of the API function's Function URL, the edge distribution's /api/* origin. */
  public readonly functionUrlDomain: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.apiFunction = new TempoFunction(this, "ApiFunction", config, {
      functionName: resourceName(config, "api"),
      component: "api",
      description: "Tempo.Api - thin HTTP entry point behind API Gateway HTTP API",
      code: resolveDotNetLambdaCode("Tempo.Api"),
      handler: "Tempo.Api",
      memoryMb: config.lambda.apiMemoryMb,
      timeoutSeconds: config.lambda.apiTimeoutSeconds,
      reservedConcurrentExecutions: config.lambda.apiReservedConcurrency,
      environment: {
        BUILD_VERSION: props.buildVersion,
        // The API validates Cognito access tokens itself (ADR-0004
        // amendment), so it needs the issuer and the accepted app clients.
        COGNITO_ISSUER: `https://${props.userPool.userPoolProviderName}`,
        COGNITO_CLIENT_IDS: props.userPoolClients.map((client) => client.userPoolClientId).join(",")
      }
    });

    const authorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", props.userPool, {
      userPoolClients: props.userPoolClients,
      authorizerName: resourceName(config, "cognito-jwt-authorizer")
    });

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: config.apiName,
      description: "Tempo HTTP API (Amazon API Gateway HTTP API, per ADR-0004)",
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [...config.corsAllowedOrigins],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS
        ],
        allowHeaders: ["Content-Type", "Authorization", "X-Tempo-Authorization", "X-Correlation-Id"],
        allowCredentials: false,
        maxAge: Duration.hours(1)
      }
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", this.apiFunction.function);

    this.httpApi.addRoutes({
      path: "/api/v1/health",
      methods: [HttpMethod.GET],
      integration
    });

    this.httpApi.addRoutes({
      path: "/api/v1/me",
      methods: [HttpMethod.GET],
      integration,
      authorizer
    });

    const accessLogGroup = createLogGroup(this, "AccessLogGroup", config, {
      logGroupName: `/aws/apigateway/${config.apiName}`
    });

    new HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogGroup),
        format: ACCESS_LOG_FORMAT
      }
    });

    // The edge distribution's /api/* origin (ADR-0009 amendment). AWS_IAM means
    // only signed requests get in: CloudFront signs every one with its origin
    // access control, so the URL cannot be called directly.
    const functionUrl = this.apiFunction.function.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
    this.functionUrlDomain = Fn.select(2, Fn.split("/", functionUrl.url));

    // The distribution lives in us-east-1 and reads this stack's URL, so naming
    // its ARN here would make the reference circular. Any distribution of this
    // account may invoke; the function URL itself is still private to them.
    const distributions = `arn:${this.partition}:cloudfront::${this.account}:distribution/*`;
    new CfnPermission(this, "AllowCloudFrontInvokeFunctionUrl", {
      action: "lambda:InvokeFunctionUrl",
      functionName: this.apiFunction.function.functionName,
      principal: "cloudfront.amazonaws.com",
      sourceArn: distributions,
      functionUrlAuthType: "AWS_IAM"
    });
    // Lambda also checks lambda:InvokeFunction for requests signed by an OAC.
    new CfnPermission(this, "AllowCloudFrontInvokeFunction", {
      action: "lambda:InvokeFunction",
      functionName: this.apiFunction.function.functionName,
      principal: "cloudfront.amazonaws.com",
      sourceArn: distributions
    });

    new CfnOutput(this, "FunctionUrlDomain", {
      description: "The API function's Function URL domain - the edge stack reads it across Regions",
      value: this.functionUrlDomain
    });

    new CfnOutput(this, "HttpApiUrl", {
      description: "Base URL for the Tempo HTTP API - read by the deployment smoke test",
      value: this.httpApi.apiEndpoint
    });

    applyStandardTags(this, config, "api");
  }
}
