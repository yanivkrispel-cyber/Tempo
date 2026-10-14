import { TempoEnvironmentConfig, validateEnvironmentConfig } from "./environment-config";

/**
 * Development environment configuration.
 *
 * The dev environment runs in the Organization's management account
 * (687239340846). The member account tempo-dev (254631022581) never finished
 * AWS activation, so on 2026-10-13 the user moved dev here (status page
 * decision D1, revised). Root domain and hosted zone are not configured, so
 * featureFlags.enableCustomDomain stays false and the HTTP API uses its
 * default execute-api endpoint.
 */
const developmentConfig: TempoEnvironmentConfig = {
  environmentName: "dev",
  accountId: "687239340846",
  region: "eu-central-1",

  apiName: "tempo-dev-http-api",

  domainName: undefined,
  hostedZoneId: undefined,

  enableDeletionProtection: false,

  // tempo-dev in Frankfurt, created 2026-10-14 (ADR-0022).
  neon: { projectId: "wild-darkness-22822656" },

  // The management account caps Lambda memory at 512 MB (the first deploy on
  // 2026-10-14 failed with "MemorySize ... less than or equal to 512"). .NET 10
  // on arm64 runs these handlers well within it.
  lambda: {
    apiMemoryMb: 512,
    apiTimeoutSeconds: 30,
    workerMemoryMb: 512,
    workerTimeoutSeconds: 60,
    apiReservedConcurrency: 10,
    workerReservedConcurrency: 5
  },

  observability: {
    enableTracing: true,
    logRetentionDays: 14,
    // ADR-0012 amendment: no alarms in development. The ten free alarms are
    // shared by the whole Organization and are kept for production.
    alarmsEnabled: false,
    // No approved alarm channel provided for dev yet; production requires this to be true.
    alarmNotificationsEnabled: false,
    alarmEmail: undefined
  },

  // ADR-0021: $1 budget that alerts on the first cent; alerts go to the
  // address chosen for decision D2 on 2026-10-13.
  cost: {
    monthlyBudgetUsd: 1,
    alertEmail: "yaniv.krispel+tempo-app@gmail.com",
    // Created by AWS when Cost Explorer was enabled in the management account on 2026-10-13.
    existingAnomalyMonitorArn: "arn:aws:ce::687239340846:anomalymonitor/2426a559-1df4-4d63-9375-c8fe4ca7a971"
  },

  github: {
    owner: "yanivkrispel-cyber",
    repo: "Tempo",
    ownerId: "282451313",
    repoId: "1317067674",
    allowedBranch: "main",
    githubEnvironment: undefined
  },

  // The edge stack is off in dev until AWS verifies the account for
  // CloudFront (the first deploy on 2026-10-14 failed: "Your account must be
  // verified before you can add new CloudFront resources"). The API answers on
  // its execute-api URL meanwhile. Turn both flags back on once AWS Support
  // confirms; the edge stack returns before the pilot in any case.
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
