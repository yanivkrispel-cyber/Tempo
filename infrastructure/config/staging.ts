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

  aurora: {
    minAcu: 0.5,
    maxAcu: 4,
    autoPauseEnabled: false,
    readerCount: 0,
    backupRetentionDays: 14
  },

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

  networking: {
    maxAzs: 2,
    natGatewayEnabled: false
  },

  github: {
    owner: "yanivkrispel-cyber",
    repo: "Tempo",
    allowedBranch: "main",
    githubEnvironment: "staging"
  },

  featureFlags: {
    enableCustomDomain: false,
    enableFrontendHosting: false,
    enableWaf: false
  },

  corsAllowedOrigins: ["https://staging-admin.tempo.example", "https://staging-client.tempo.example"],

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
