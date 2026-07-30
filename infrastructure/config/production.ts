import { TempoEnvironmentConfig, validateEnvironmentConfig } from "./environment-config";

/**
 * Production configuration. Not deployed by this change set - it exists so
 * that `cdk synth` validates the production safety invariants (deletion
 * protection, no auto-pause, non-zero minimum ACU, alarm notifications,
 * protected GitHub environment) enforced by validateEnvironmentConfig().
 *
 * TODO before production is actually deployed: replace the placeholder AWS
 * account id, domain, hosted zone id, Cognito callback URLs and alarm email
 * with real, reviewed values. Production must live in its own AWS account
 * per ADR-0014.
 */
const productionConfig: TempoEnvironmentConfig = {
  environmentName: "prod",
  accountId: "000000000000", // placeholder - production account not yet provisioned
  region: "eu-central-1",

  apiName: "tempo-prod-http-api",

  domainName: undefined,
  hostedZoneId: undefined,

  enableDeletionProtection: true,

  aurora: {
    minAcu: 1,
    maxAcu: 8,
    autoPauseEnabled: false,
    readerCount: 0,
    backupRetentionDays: 30
  },

  lambda: {
    apiMemoryMb: 1024,
    apiTimeoutSeconds: 30,
    workerMemoryMb: 1024,
    workerTimeoutSeconds: 120,
    apiReservedConcurrency: 50,
    workerReservedConcurrency: 20
  },

  observability: {
    enableTracing: true,
    logRetentionDays: 90,
    alarmNotificationsEnabled: true,
    alarmEmail: "aws-alerts@tempo.example"
  },

  networking: {
    maxAzs: 2,
    natGatewayEnabled: false
  },

  github: {
    owner: "yanivkrispel-cyber",
    repo: "Tempo",
    allowedBranch: "main",
    githubEnvironment: "production"
  },

  featureFlags: {
    enableCustomDomain: false,
    enableFrontendHosting: false,
    enableWaf: false
  },

  corsAllowedOrigins: ["https://app.tempo.example", "https://client.tempo.example"],

  cognitoCallbackUrls: {
    adminWeb: ["https://app.tempo.example/auth/callback"],
    clientWeb: ["https://client.tempo.example/auth/callback"],
    platformAdminWeb: ["https://platform.tempo.example/auth/callback"]
  },
  cognitoLogoutUrls: {
    adminWeb: ["https://app.tempo.example/"],
    clientWeb: ["https://client.tempo.example/"],
    platformAdminWeb: ["https://platform.tempo.example/"]
  },

  tags: {
    owner: "Platform",
    costCenter: "Tempo"
  }
};

export default validateEnvironmentConfig(productionConfig);
