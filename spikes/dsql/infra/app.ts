#!/usr/bin/env node
/*
 * Throwaway infrastructure for the Aurora DSQL spike (council decision Q2).
 * Deployed only to the tempo-dev member account and destroyed when the
 * spike report is written. Nothing here bills by the hour: the cluster,
 * the two Lambdas and the backup vault cost nothing while idle.
 *
 *   NODE_PATH=infrastructure/node_modules infrastructure/node_modules/.bin/cdk deploy --app "node infrastructure/node_modules/ts-node/dist/bin.js --prefer-ts-exts spikes/dsql/infra/app.ts" --profile tempo-dev-member
 *   (same with destroy instead of deploy)
 */
import * as path from "node:path";
import { App, CfnOutput, Duration, RemovalPolicy, Stack, StackProps, Tags } from "aws-cdk-lib";
import * as backup from "aws-cdk-lib/aws-backup";
import * as dsql from "aws-cdk-lib/aws-dsql";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

const PUBLISH_DIR = path.join(__dirname, "..", "Tempo.Spike.Dsql", "bin", "Release", "net10.0", "linux-arm64", "publish");

class DsqlSpikeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const cluster = new dsql.CfnCluster(this, "Cluster", {
      deletionProtectionEnabled: false
    });

    // The Lambdas authenticate as the custom database roles tempo_app and
    // tempo_migrator (dsql:DbConnect). Only the admin role needs
    // dsql:DbConnectAdmin, and the spike runs admin steps from a workstation.
    const functionRole = new iam.Role(this, "FunctionRole", {
      roleName: "tempo-dsql-spike-function",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")]
    });
    functionRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dsql:DbConnect"],
      resources: [cluster.attrResourceArn]
    }));

    const code = lambda.Code.fromAsset(PUBLISH_DIR);

    // 1024 MB matches the API function's memory in config/development.ts and
    // is the configuration the latency criteria are judged on. 2048 MB gives
    // the 100-client burst enough CPU that the client is not the bottleneck.
    for (const memoryMb of [1024, 2048]) {
      const functionName = `tempo-dsql-spike-${memoryMb}`;
      const logGroup = new logs.LogGroup(this, `Logs${memoryMb}`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY
      });

      new lambda.Function(this, `Spike${memoryMb}`, {
        functionName,
        runtime: lambda.Runtime.DOTNET_10,
        architecture: lambda.Architecture.ARM_64,
        handler: "Tempo.Spike.Dsql::Tempo.Spike.Dsql.Function::Handler",
        code,
        memorySize: memoryMb,
        timeout: Duration.minutes(5),
        role: functionRole,
        logGroup,
        environment: {
          SPIKE_ENGINE: "dsql",
          SPIKE_HOST: cluster.attrEndpoint,
          SPIKE_REGION: this.region
        }
      });
    }

    const vault = new backup.BackupVault(this, "Vault", {
      backupVaultName: "tempo-dsql-spike",
      removalPolicy: RemovalPolicy.DESTROY
    });

    const backupRole = new iam.Role(this, "BackupRole", {
      roleName: "tempo-dsql-spike-backup",
      assumedBy: new iam.ServicePrincipal("backup.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBackupServiceRolePolicyForBackup"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSBackupServiceRolePolicyForRestores")
      ]
    });

    new CfnOutput(this, "ClusterIdentifier", { value: cluster.attrIdentifier });
    new CfnOutput(this, "ClusterEndpoint", { value: cluster.attrEndpoint });
    new CfnOutput(this, "ClusterArn", { value: cluster.attrResourceArn });
    new CfnOutput(this, "FunctionRoleArn", { value: functionRole.roleArn });
    new CfnOutput(this, "BackupVaultName", { value: vault.backupVaultName });
    new CfnOutput(this, "BackupRoleArn", { value: backupRole.roleArn });
  }
}

const app = new App();
const stack = new DsqlSpikeStack(app, "TempoDsqlSpike", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "eu-central-1" },
  description: "Aurora DSQL spike (throwaway). Destroy after the spike report."
});
Tags.of(stack).add("project", "tempo");
Tags.of(stack).add("purpose", "dsql-spike");
Tags.of(stack).add("environment", "dev");
app.synth();
