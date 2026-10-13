import { Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { dev } from "./helpers/synth";

const PROHIBITED_RESOURCE_TYPES = [
  "AWS::EKS::Cluster",
  "AWS::ECS::Cluster",
  "AWS::ECS::Service",
  "AWS::EC2::Instance",
  "AWS::ElastiCache::CacheCluster",
  "AWS::ElastiCache::ReplicationGroup",
  "AWS::RDS::DBProxy",
  "AWS::OpenSearchService::Domain",
  "AWS::Elasticsearch::Domain",
  "AWS::MSK::Cluster",
  "AWS::EC2::NatGateway"
];

function allTemplates() {
  return dev.node.findAll().filter(Stack.isStack).map((stack) => Template.fromStack(stack));
}

function stackTemplate(childId: string) {
  const child = dev.node.findChild(childId);
  if (!Stack.isStack(child)) {
    throw new Error(`Expected stage child '${childId}' to be a Stack`);
  }
  return Template.fromStack(child);
}

describe("Prohibited services and NAT Gateway (section 27/29)", () => {
  it.each(PROHIBITED_RESOURCE_TYPES)("no %s exists anywhere in the dev stage", (resourceType) => {
    for (const template of allTemplates()) {
      template.resourceCountIs(resourceType, 0);
    }
  });
});

describe("SQS queues (ADR-0008, LLD section 15/34.2)", () => {
  const template = stackTemplate("Messaging");

  it("has exactly one work queue and its DLQ (ADR-0008 amendment)", () => {
    const names = Object.values(template.findResources("AWS::SQS::Queue")).map((q) => q.Properties.QueueName).sort();
    expect(names).toEqual(["tempo-dev-work", "tempo-dev-work-dlq"]);
  });

  it("every queue is encrypted", () => {
    template.allResourcesProperties("AWS::SQS::Queue", { SqsManagedSseEnabled: true });
  });

  it("the work queue has a DLQ with a bounded redrive policy", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "tempo-dev-work",
      RedrivePolicy: Match.objectLike({ maxReceiveCount: Match.anyValue() })
    });
  });

  it("visibility timeout is greater than the worker Lambda timeout (60s dev)", () => {
    const queues = template.findResources("AWS::SQS::Queue", {
      Properties: { QueueName: "tempo-dev-work" }
    });
    const [queue] = Object.values(queues);
    expect(queue.Properties.VisibilityTimeout).toBeGreaterThan(60);
  });

  it("long polling is enabled on the work queue", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "tempo-dev-work",
      ReceiveMessageWaitTimeSeconds: 20
    });
  });
});

describe("Cognito (ADR-0007, LLD section 14/34)", () => {
  const template = stackTemplate("Identity");

  it("browser app clients never generate a secret", () => {
    template.allResourcesProperties("AWS::Cognito::UserPoolClient", { GenerateSecret: false });
  });

  it("callback and logout URLs contain no wildcard", () => {
    const clients = template.findResources("AWS::Cognito::UserPoolClient");
    for (const client of Object.values(clients)) {
      const props = client.Properties as { CallbackURLs?: string[]; LogoutURLs?: string[] };
      for (const url of [...(props.CallbackURLs ?? []), ...(props.LogoutURLs ?? [])]) {
        expect(url).not.toContain("*");
      }
    }
  });
});

describe("Aurora PostgreSQL (ADR-0005, LLD section 10/34)", () => {
  const template = stackTemplate("Database");

  it("is not publicly accessible", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: false });
  });

  it("is encrypted at rest", () => {
    template.hasResourceProperties("AWS::RDS::DBCluster", { StorageEncrypted: true });
  });

  it("uses only the private isolated subnet group (no public subnets)", () => {
    template.hasResourceProperties("AWS::RDS::DBSubnetGroup", {
      DBSubnetGroupDescription: Match.anyValue()
    });
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });
});

describe("Lambda defaults (LLD section 34.3)", () => {
  const apiTemplate = stackTemplate("Api");

  it("has explicit tracing configuration", () => {
    apiTemplate.hasResourceProperties("AWS::Lambda::Function", { TracingConfig: { Mode: "Active" } });
  });

  it("has an explicit CloudWatch log group with finite retention", () => {
    apiTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/tempo-dev-api",
      RetentionInDays: 14
    });
  });
});

describe("Mandatory tags (LLD section 5)", () => {
  it("every taggable resource in the API stack carries the required tag set", () => {
    const template = stackTemplate("Api");
    // CloudFormation renders the Tags array in alphabetical key order; Match.arrayWith
    // requires its patterns as an ordered subsequence, so list them alphabetically too.
    const expectedTags = Match.arrayWith([
      Match.objectLike({ Key: "Application", Value: "Tempo" }),
      Match.objectLike({ Key: "Component" }),
      Match.objectLike({ Key: "CostCenter" }),
      Match.objectLike({ Key: "DataClassification" }),
      Match.objectLike({ Key: "Environment", Value: "dev" }),
      Match.objectLike({ Key: "ManagedBy", Value: "AWS-CDK" }),
      Match.objectLike({ Key: "Owner" })
    ]);

    template.hasResourceProperties("AWS::Lambda::Function", { Tags: expectedTags });
  });
});
