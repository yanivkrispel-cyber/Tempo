import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TempoEnvironmentConfig } from "../config/environment-config";
import { AccountBaselineStack } from "./foundations/account-baseline-stack";
import { GitHubOidcStack } from "./foundations/github-oidc-stack";
import { SecurityStack } from "./security/security-stack";
import { IdentityStack } from "./identity/identity-stack";
import { DatabaseStack } from "./data/database-stack";
import { MessagingStack } from "./async/messaging-stack";
import { ApiStack } from "./api/api-stack";
import { ObservabilityStack } from "./observability/observability-stack";
import { EdgeStack } from "./edge/edge-stack";
import { DevCanaryStack } from "./observability/dev-canary-stack";

export interface TempoStageProps extends StageProps {
  readonly config: TempoEnvironmentConfig;
  readonly buildVersion: string;
}

/**
 * One TempoStage per environment, wiring every stack in the deployment
 * order from docs/01_AWS_Infrastructure_LLD.md section 32. Construct
 * references are passed directly between stacks within the Stage rather
 * than through SSM/cross-stack exports, per LLD section 7.1.
 *
 * The edge stack (CloudFront, WAF, PWA bucket) runs in us-east-1, the only
 * Region with CLOUDFRONT-scope web ACLs. It reads the API stack's Function URL
 * through a cross-Region reference. No custom domain yet: the distribution
 * serves on its *.cloudfront.net name.
 */
export class TempoStage extends Stage {
  constructor(scope: Construct, id: string, props: TempoStageProps) {
    super(scope, id, props);
    const { config } = props;
    const env = { account: config.accountId, region: config.region };

    new AccountBaselineStack(this, "AccountBaseline", { config, env });
    new GitHubOidcStack(this, "GitHubOidc", { config, env });

    new SecurityStack(this, "Security", { config, env });

    const identity = new IdentityStack(this, "Identity", { config, env });

    // ADR-0022: the database is Neon, outside AWS, so there is no VPC and no
    // network stack. This stack holds only the migrator.
    const database = new DatabaseStack(this, "Database", { config, env });

    // ADR-0008 amendment: one work queue. An EventBridge bus is added only
    // for real fan-out. The canary schedule lives in the edge stack; the
    // outbox sweeper schedule arrives with the outbox table (step 7). Scheduler's
    // templated SQS target cannot set the MessageType attribute the worker
    // routes on; its universal sqs:sendMessage target can (the tripwire uses it).
    const messaging = new MessagingStack(this, "Messaging", { config, env });

    const api = new ApiStack(this, "Api", {
      config,
      env,
      userPool: identity.userPool,
      userPoolClients: [identity.adminWebClient, identity.clientWebClient],
      operatorPool: identity.operatorPool,
      operatorPoolClients: [identity.platformAdminWebClient],
      buildVersion: props.buildVersion,
      crossRegionReferences: config.featureFlags.enableFrontendHosting
    });

    if (config.featureFlags.enableFrontendHosting) {
      new EdgeStack(this, "Edge", {
        config,
        env: { account: config.accountId, region: "us-east-1" },
        crossRegionReferences: true,
        apiFunctionUrlDomain: api.functionUrlDomain
      });
    }

    if (config.featureFlags.enableDevCanary && config.featureFlags.enableSmokeTestSignIn) {
      new DevCanaryStack(this, "Canary", {
        config,
        env,
        httpApi: api.httpApi,
        userPool: identity.userPool,
        clientWebClient: identity.clientWebClient
      });
    }

    new ObservabilityStack(this, "Observability", {
      config,
      env,
      httpApi: api.httpApi,
      apiFunction: api.apiFunction.function,
      workerFunction: messaging.workerFunction.function,
      migratorFunction: database.migratorFunction.function
    });
  }
}
