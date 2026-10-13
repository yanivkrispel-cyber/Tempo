import { TempoEnvironmentConfig, validateEnvironmentConfig } from "./environment-config";

/**
 * Development environment configuration.
 *
 * The dev environment runs in its own member account, tempo-dev
 * (254631022581, created 2026-10-13, status page decision D1), never in the
 * Organization's management account. Root domain and hosted zone are not configured, so
 * featureFlags.enableCustomDomain stays false and the HTTP API uses its
 * default execute-api endpoint.
 */
const developmentConfig: TempoEnvironmentConfig = {
  environmentName: "dev",
  accountId: "254631022581",
  region: "eu-central-1",

  apiName: "tempo-dev-http-api",

  domainName: undefined,
  hostedZoneId: undefined,

  enableDeletionProtection: false,

  aurora: {
    minAcu: 0,
    maxAcu: 2,
    autoPauseEnabled: true,
    readerCount: 0,
    backupRetentionDays: 7
  },

  lambda: {
    apiMemoryMb: 1024,
    apiTimeoutSeconds: 30,
    workerMemoryMb: 1024,
    workerTimeoutSeconds: 60,
    apiReservedConcurrency: 10,
    workerReservedConcurrency: 5
  },

  observability: {
    enableTracing: true,
    logRetentionDays: 14,
    // No approved alarm channel provided for dev yet; production requires this to be true.
    alarmNotificationsEnabled: false,
    alarmEmail: undefined
  },

  // ADR-0021: $1 budget that alerts on the first cent; alerts go to the
  // address chosen for decision D2 on 2026-10-13.
  cost: {
    monthlyBudgetUsd: 1,
    alertEmail: "yaniv.krispel+tempo-app@gmail.com"
  },

  networking: {
    maxAzs: 2,
    natGatewayEnabled: false
  },

  github: {
    owner: "yanivkrispel-cyber",
    repo: "Tempo",
    allowedBranch: "main",
    githubEnvironment: undefined
  },

  featureFlags: {
    enableCustomDomain: false,
    enableFrontendHosting: false,
    enableWaf: false
  },

  corsAllowedOrigins: [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175"
  ],

  cognitoCallbackUrls: {
    adminWeb: ["http://localhost:5173/auth/callback"],
    clientWeb: ["http://localhost:5174/auth/callback"],
    platformAdminWeb: ["http://localhost:5175/auth/callback"]
  },
  cognitoLogoutUrls: {
    adminWeb: ["http://localhost:5173/"],
    clientWeb: ["http://localhost:5174/"],
    platformAdminWeb: ["http://localhost:5175/"]
  },

  tags: {
    owner: "Platform",
    costCenter: "Tempo"
  }
};

export default validateEnvironmentConfig(developmentConfig);
