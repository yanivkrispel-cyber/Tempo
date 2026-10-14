import { Stack, StackProps } from "aws-cdk-lib";
import { IStringParameter, StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { applyStandardTags } from "../constructs/tagging";

export interface DatabaseStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/** SSM SecureString parameters under /tempo/<env>/db/ that a person writes (ADR-0022). */
export const DATABASE_PARAMETERS = {
  /** The Neon owner role's postgresql:// URL on the direct (not -pooler) endpoint. */
  ownerUrl: "neon-connection-string",
  /** Password of `tempo_app`, the least-privileged runtime role. Letters and digits only. */
  applicationPassword: "app-password",
  /** Password of `tempo_migrator`, the schema-owning role. Letters and digits only. */
  migratorPassword: "migrator-password"
} as const;

export function databaseParameterName(config: TempoEnvironmentConfig, key: keyof typeof DATABASE_PARAMETERS): string {
  return `/tempo/${config.environmentName}/db/${DATABASE_PARAMETERS[key]}`;
}

/**
 * The database is Neon serverless Postgres, outside CloudFormation (ADR-0022).
 * This stack holds only Tempo.DatabaseMigrator, which reaches Neon over its
 * public TLS endpoint without a VPC.
 *
 * Connection details are SSM SecureString parameters on the AWS managed
 * `aws/ssm` key. CloudFormation cannot create SecureString values, and the
 * values must never pass through CDK, so a person writes them (see
 * infrastructure/README.md, "Database credentials"). The function gets read
 * access to exactly these three parameters; the AWS managed key needs no
 * kms:Decrypt grant.
 *
 * Three identities (LLD section 12): the Neon owner bootstraps the
 * `tempo_migrator` and `tempo_app` roles with the stored passwords on every
 * run (see backend/Tempo.DatabaseMigrator/BootstrapRoles.cs), and DbUp then
 * migrates as `tempo_migrator`.
 */
export class DatabaseStack extends Stack {
  public readonly migratorFunction: TempoFunction;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    const { config } = props;

    const parameter = (key: keyof typeof DATABASE_PARAMETERS): IStringParameter =>
      StringParameter.fromSecureStringParameterAttributes(this, `${key}Parameter`, {
        parameterName: databaseParameterName(config, key)
      });
    const ownerUrl = parameter("ownerUrl");
    const applicationPassword = parameter("applicationPassword");
    const migratorPassword = parameter("migratorPassword");

    this.migratorFunction = new TempoFunction(this, "MigratorFunction", config, {
      functionName: resourceName(config, "database-migrator"),
      component: "database-migrator",
      description:
        "Tempo.DatabaseMigrator - deployment-only. Not exposed through API Gateway; invocation is restricted to the deployment role.",
      code: resolveDotNetLambdaCode("Tempo.DatabaseMigrator"),
      handler: "Tempo.DatabaseMigrator::Tempo.DatabaseMigrator.Function::FunctionHandler",
      memoryMb: config.lambda.workerMemoryMb,
      // Migrations can legitimately take longer than a typical worker invocation.
      timeoutSeconds: 900,
      dataClassification: "Confidential",
      environment: {
        OWNER_URL_PARAMETER: ownerUrl.parameterName,
        APPLICATION_PASSWORD_PARAMETER: applicationPassword.parameterName,
        MIGRATOR_PASSWORD_PARAMETER: migratorPassword.parameterName
      }
    });

    for (const p of [ownerUrl, applicationPassword, migratorPassword]) {
      p.grantRead(this.migratorFunction.function);
    }

    applyStandardTags(this, config, "database", "Confidential");
  }
}
