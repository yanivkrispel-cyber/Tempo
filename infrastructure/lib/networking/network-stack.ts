import { Stack, StackProps } from "aws-cdk-lib";
import {
  InterfaceVpcEndpointAwsService,
  IVpc,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { TempoEnvironmentConfig, resourceName } from "../../config/environment-config";
import { applyStandardTags } from "../constructs/tagging";

export interface NetworkStackProps extends StackProps {
  readonly config: TempoEnvironmentConfig;
}

/**
 * One VPC per environment (LLD section 9). Only private isolated subnets
 * exist - there is no NAT Gateway and no public subnet, per ADR-0017's
 * guardrails and the explicit dev-config instruction to keep NAT disabled.
 *
 * Networking decision for this Phase 0 slice (documented per LLD section
 * 9.3): the API Lambda (health endpoint only) and the outbox worker skeleton
 * do not yet perform any Aurora I/O, so neither is attached to the VPC -
 * this avoids interface-endpoint cost and VPC cold starts before there is a
 * real consumer. Only Tempo.DatabaseMigrator, which must reach Aurora and
 * Secrets Manager at deploy time, attaches to `lambdaDbSecurityGroup` in
 * `privateIsolatedSubnets`. The first Lambda that gains real Aurora business
 * logic (e.g. the outbox worker) must attach to the same security group and
 * subnets at that time.
 */
export class NetworkStack extends Stack {
  public readonly vpc: Vpc;
  public readonly auroraSecurityGroup: SecurityGroup;
  public readonly lambdaDbSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.vpc = new Vpc(this, "Vpc", {
      vpcName: resourceName(config, "vpc"),
      maxAzs: config.networking.maxAzs,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24
        }
      ]
    });

    this.lambdaDbSecurityGroup = new SecurityGroup(this, "LambdaDbSecurityGroup", {
      securityGroupName: resourceName(config, "lambda-db-sg"),
      description: "Attached to Lambda functions that require direct Aurora PostgreSQL access",
      vpc: this.vpc,
      allowAllOutbound: false
    });

    this.auroraSecurityGroup = new SecurityGroup(this, "AuroraSecurityGroup", {
      securityGroupName: resourceName(config, "aurora-sg"),
      description: "Attached to the Aurora PostgreSQL Serverless v2 cluster",
      vpc: this.vpc,
      allowAllOutbound: false
    });

    this.auroraSecurityGroup.addIngressRule(
      this.lambdaDbSecurityGroup,
      Port.tcp(5432),
      "PostgreSQL from database-connected Lambda functions only"
    );
    this.lambdaDbSecurityGroup.addEgressRule(
      this.auroraSecurityGroup,
      Port.tcp(5432),
      "PostgreSQL to the Aurora cluster"
    );

    // Justified interface endpoint: Tempo.DatabaseMigrator runs in these
    // isolated subnets (no NAT) and must read its database secret at deploy
    // time. No other VPC endpoints are added in this phase - see class doc.
    this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      privateDnsEnabled: true
    });
    this.lambdaDbSecurityGroup.addEgressRule(
      Peer.ipv4(this.vpc.vpcCidrBlock),
      Port.tcp(443),
      "HTTPS to the Secrets Manager interface VPC endpoint"
    );

    applyStandardTags(this, config, "networking");
  }
}

export function selectDatabaseSubnets(vpc: IVpc) {
  return vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED });
}
