import { TempoEnvironmentConfig, validateEnvironmentConfig } from "./environment-config";

/**
 * Staging configuration. Not deployed by this change set - it exists so that
 * `cdk synth`/`cdk diff` can validate the staging shape (LLD section 39) and
 * so staging never has to be invented under production-launch pressure.
 *
 * TODO before staging is actually deployed: replace the placeholder AWS
 * account id, domain and Cognito callback URLs with real values.
 */
const stagingConfig: TempoEnvironmentConfig = {
  environmentName: "stg",
  accountId: "000000000000", // placeholder - staging account not yet provisioned
  region: "eu-central-1",

  apiName: "tempo-stg-http-api",

  domainName: undefined,
  hostedZoneId: undefined,

  enableDeletionProtection: true,

  operatorMfa: "required",

  // Placeholder until the project exists (ADR-0022: one Neon project per environment).
  neon: { projectId: "not-created-yet" },

  lambda: {
    apiMemoryMb: 1024,
    apiTimeoutSeconds: 30,
    workerMemoryMb: 1024,
    workerTimeoutSeconds: 120,
    apiReservedConcurrency: 20,
    workerReservedConcurrency: 10
  },

  observability: {
    enableTracing: true,
    logRetentionDays: 30,
    alarmsEnabled: true,
    alarmNotificationsEnabled: true,
    alarmEmail: "aws-alerts@tempo.example"
  },

  cost: {
    monthlyBudgetUsd: 1,
    alertEmail: "aws-alerts@tempo.example"
  },

  github: {
    owner: "yanivkrispel-cyber",
    ownerId: 282451313,
    repo: "Tempo",
    repoId: 1317067674,
    allowedBranch: "main",
    githubEnvironment: "staging"
  },

  featureFlags: {
    enableCustomDomain: false,
    enableFrontendHosting: false,
    enableWaf: false
  },

  // Below the stage's 50 and 100 (board #404, S-A), and both bursts together below the API's reserved concurrency,
  // so anonymous traffic can never take every execution (a 70-request burst gave 50 503s on 2026-10-20). Per-client
  // limits are the API's own counters.
  publicThrottle: {
    reads: { rateLimit: 10, burstLimit: 12 },
    join: { rateLimit: 2, burstLimit: 4 }
  },

  corsAllowedOrigins: ["https://staging-admin.tempo.example", "https://staging-client.tempo.example"],

  // The members app's host; a change means members register their passkeys again (docs/36 F-4).
  passkeyRelyingPartyId: "staging-client.tempo.example",

  cognitoCallbackUrls: {
    adminWeb: ["https://staging-admin.tempo.example/auth/callback"],
    clientWeb: ["https://staging-client.tempo.example/auth/callback"],
    platformAdminWeb: ["https://staging-platform.tempo.example/auth/callback"]
  },
  cognitoLogoutUrls: {
    adminWeb: ["https://staging-admin.tempo.example/"],
    clientWeb: ["https://staging-client.tempo.example/"],
    platformAdminWeb: ["https://staging-platform.tempo.example/"]
  },

  tags: {
    owner: "Platform",
    costCenter: "Tempo"
  }
};

export default validateEnvironmentConfig(stagingConfig);
