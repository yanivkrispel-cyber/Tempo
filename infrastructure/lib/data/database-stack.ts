import { Duration, RemovalPolicy, Stack, StackProps, Validations } from "aws-cdk-lib";
import { ISecurityGroup, IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
  PerformanceInsightRetention
} from "aws-cdk-lib/aws-rds";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { resolveDotNetLambdaCode } from "../constructs/dotnet-lambda-code";
import { TempoFunction } from "../constructs/lambda-defaults";
import { applyStandardTags } from "../constructs/tagging";

export interface DatabaseStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
  readonly vpc: IVpc;
  readonly databaseSubnets: SubnetSelection;
  readonly auroraSecurityGroup: ISecurityGroup;
  readonly lambdaDbSecurityGroup: ISecurityGroup;
}

const DATABASE_NAME = "tempo";

/**
 * Aurora PostgreSQL Serverless v2 (ADR-0005). One writer, zero readers in
 * every environment for now (a reader is added only once SLO/read-pressure
 * evidence justifies it, per LLD section 10.2). Credentials are never
 * exposed as CDK outputs or environment variable values - only secret ARNs
 * leave this stack.
 *
 * Three identities are prepared here (LLD section 12): the master/bootstrap
 * secret (managed by the cluster itself), and generated `application` and
 * `migrator` secrets. The Postgres roles matching the latter two are created
 * by Tempo.DatabaseMigrator's bootstrap step the first time it runs (CDK
 * cannot issue `CREATE ROLE` - only Tempo.DatabaseMigrator, using the master
 * secret, can) - see backend/Tempo.DatabaseMigrator/BootstrapRoles.cs.
 */
export class DatabaseStack extends Stack {
  public readonly cluster: DatabaseCluster;
  public readonly applicationSecret: Secret;
  public readonly migratorSecret: Secret;
  public readonly migratorFunction: TempoFunction;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.cluster = new DatabaseCluster(this, "Cluster", {
      clusterIdentifier: resourceName(config, "aurora"),
      engine: DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_17_9 }),
      vpc: props.vpc,
      vpcSubnets: props.databaseSubnets,
      securityGroups: [props.auroraSecurityGroup],
      defaultDatabaseName: DATABASE_NAME,
      credentials: Credentials.fromGeneratedSecret("tempo_master", {
        secretName: `tempo/${config.environmentName}/database/master`
      }),
      writer: ClusterInstance.serverlessV2("Writer", {
        instanceIdentifier: resourceName(config, "aurora-writer"),
        enablePerformanceInsights: true,
        performanceInsightRetention: PerformanceInsightRetention.DEFAULT
      }),
      readers: [],
      serverlessV2MinCapacity: config.aurora.minAcu,
      serverlessV2MaxCapacity: config.aurora.maxAcu,
      serverlessV2AutoPauseDuration: config.aurora.autoPauseEnabled ? Duration.minutes(5) : undefined,
      storageEncrypted: true,
      deletionProtection: config.enableDeletionProtection,
      removalPolicy: config.enableDeletionProtection ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      backup: {
        retention: Duration.days(config.aurora.backupRetentionDays)
      },
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logRetention(config.observability.logRetentionDays),
      copyTagsToSnapshot: true
    });
    // Rule W9008 checks StorageEncrypted on each AWS::RDS::DBInstance, but Aurora
    // instances take their encryption from the cluster (storageEncrypted above).
    // CDK applies an acknowledgement to the rule app-wide, and RDS exists only in
    // this stack, which Tempo Zero replaces with DSQL (status page step 7).
    Validations.of(this.cluster).acknowledge({
      id: "CloudFormation-Validate::W9008",
      reason: "Aurora cluster instances inherit encryption from the cluster, which sets StorageEncrypted: true"
    });

    this.applicationSecret = new Secret(this, "ApplicationSecret", {
      secretName: `tempo/${config.environmentName}/database/application`,
      description: "Tempo API/worker runtime database credentials (least-privilege application role)",
      removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "tempo_app", dbname: DATABASE_NAME }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32
      }
    });

    this.migratorSecret = new Secret(this, "MigratorSecret", {
      secretName: `tempo/${config.environmentName}/database/migrator`,
      description: "Tempo.DatabaseMigrator database credentials (schema-owning role, deployment-role invocation only)",
      removalPolicy: config.environmentName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "tempo_migrator", dbname: DATABASE_NAME }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32
      }
    });

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
      vpc: props.vpc,
      vpcSubnets: props.databaseSubnets,
      securityGroups: [props.lambdaDbSecurityGroup],
      dataClassification: "Confidential",
      environment: {
        MASTER_SECRET_ARN: this.cluster.secret!.secretArn,
        APPLICATION_SECRET_ARN: this.applicationSecret.secretArn,
        MIGRATOR_SECRET_ARN: this.migratorSecret.secretArn
      }
    });

    this.cluster.secret!.grantRead(this.migratorFunction.function);
    this.applicationSecret.grantRead(this.migratorFunction.function);
    this.migratorSecret.grantRead(this.migratorFunction.function);

    applyStandardTags(this, config, "database", "Confidential");
  }
}

function logRetention(days: number): RetentionDays {
  const map: Record<number, RetentionDays> = {
    7: RetentionDays.ONE_WEEK,
    14: RetentionDays.TWO_WEEKS,
    30: RetentionDays.ONE_MONTH,
    60: RetentionDays.TWO_MONTHS,
    90: RetentionDays.THREE_MONTHS
  };
  return map[days] ?? RetentionDays.TWO_WEEKS;
}
