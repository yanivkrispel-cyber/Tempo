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
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CfnPermission, FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";
import { IStringParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { createLogGroup } from "../constructs/log-group-defaults";
import { TempoFunction } from "../constructs/lambda-defaults";
import { applyStandardTags } from "../constructs/tagging";
import { databaseParameterName } from "../data/database-stack";

export interface ApiStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly userPool: IUserPool;
  readonly userPoolClients: IUserPoolClient[];
  /** The Tempo team's pool (ADR-0023); its tokens are accepted only on /api/v1/platform/*. */
  readonly operatorPool: IUserPool;
  readonly operatorPoolClients: IUserPoolClient[];
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
 * public TLS endpoint). The API connects as `tempo_app` and `tempo_platform`
 * (docs/26 section 7.2) through Neon's pooled endpoint, and may read exactly
 * those two passwords from SSM, never the owner URL or the migrator's.
 *
 * Phase 1 routes (contracts/openapi/tempo-api.v1.yaml) reach the function
 * through one `ANY /api/v1/{proxy+}` route without an API Gateway
 * authorizer: the API validates both pools' tokens itself (ADR-0004
 * amendment, ADR-0023), and the gateway's JWT authorizer knows only the
 * customer pool, so it would turn away operator tokens.
 */
export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;
  public readonly apiFunction: TempoFunction;
  /** Domain of the API function's Function URL, the edge distribution's /api/* origin. */
  public readonly functionUrlDomain: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;
    const database = this.databaseConnection(config);

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
        COGNITO_CLIENT_IDS: props.userPoolClients.map((client) => client.userPoolClientId).join(","),
        COGNITO_OPERATOR_ISSUER: `https://${props.operatorPool.userPoolProviderName}`,
        COGNITO_OPERATOR_CLIENT_IDS: props.operatorPoolClients.map((client) => client.userPoolClientId).join(","),
        ...database.environment
      }
    });

    for (const parameter of database.passwords) {
      parameter.grantRead(this.apiFunction.function);
    }

    // Account provisioning reads the caller's email from Cognito, because
    // access tokens carry no email claim (Phase 1 LLD section 2.3). Only the
    // customer pool, and only this one read.
    this.apiFunction.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [props.userPool.userPoolArn]
      })
    );

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

    this.httpApi.addRoutes({
      path: "/api/v1/{proxy+}",
      methods: [HttpMethod.ANY],
      integration
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

  /**
   * Where the API's runtime roles connect, and the two password parameters
   * the function may read. Empty until the environment's Neon project exists.
   */
  private databaseConnection(config: TempoEnvironmentConfig): {
    environment: Record<string, string>;
    passwords: IStringParameter[];
  } {
    if (config.neon.pooledHost === undefined || config.neon.databaseName === undefined) {
      return { environment: {}, passwords: [] };
    }

    const [application, platform] = (["applicationPassword", "platformPassword"] as const).map((key) =>
      StringParameter.fromSecureStringParameterAttributes(this, `${key}Parameter`, {
        parameterName: databaseParameterName(config, key)
      })
    );

    return {
      environment: {
        DATABASE_HOST: config.neon.pooledHost,
        DATABASE_NAME: config.neon.databaseName,
        DATABASE_APP_PASSWORD_PARAMETER: application.parameterName,
        DATABASE_PLATFORM_PASSWORD_PARAMETER: platform.parameterName
      },
      passwords: [application, platform]
    };
  }
}
