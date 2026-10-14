import { describe, expect, it } from "vitest";
import { TempoEnvironmentConfig, validateEnvironmentConfig } from "../../config/environment-config";

function baseConfig(overrides: Partial<TempoEnvironmentConfig> = {}): TempoEnvironmentConfig {
  return {
    environmentName: "dev",
    accountId: "123456789012",
    region: "eu-central-1",
    apiName: "tempo-dev-http-api",
    domainName: undefined,
    hostedZoneId: undefined,
    enableDeletionProtection: false,
    neon: { projectId: "wild-darkness-22822656" },
    lambda: {
      apiMemoryMb: 1024,
      apiTimeoutSeconds: 30,
      workerMemoryMb: 1024,
      workerTimeoutSeconds: 60,
      apiReservedConcurrency: 10,
      workerReservedConcurrency: 5
    },
    observability: { enableTracing: true, logRetentionDays: 14, alarmsEnabled: false, alarmNotificationsEnabled: false, alarmEmail: undefined },
    cost: { monthlyBudgetUsd: 1, alertEmail: "alerts@example.com" },
    github: { owner: "yanivkrispel-cyber", repo: "Tempo", allowedBranch: "main", githubEnvironment: undefined },
    featureFlags: { enableCustomDomain: false, enableFrontendHosting: false, enableWaf: false },
    corsAllowedOrigins: ["http://localhost:5173"],
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
    tags: { owner: "Platform", costCenter: "Tempo" },
    ...overrides
  };
}

describe("validateEnvironmentConfig", () => {
  it("accepts a valid development configuration", () => {
    expect(() => validateEnvironmentConfig(baseConfig())).not.toThrow();
  });

  it("rejects a malformed account id", () => {
    expect(() => validateEnvironmentConfig(baseConfig({ accountId: "not-an-account-id" }))).toThrow();
  });

  it("rejects a region other than eu-central-1", () => {
    expect(() => validateEnvironmentConfig(baseConfig({ region: "us-east-1" }))).toThrow();
  });


  it("rejects a wildcard Cognito callback URL", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          cognitoCallbackUrls: {
            adminWeb: ["https://*.tempo.example/auth/callback"],
            clientWeb: [],
            platformAdminWeb: []
          }
        })
      )
    ).toThrow(/wildcard/);
  });

  it("rejects production without deletion protection", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: false,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: true, alarmNotificationsEnabled: true, alarmEmail: "a@b.com" },
          github: { owner: "x", repo: "y", allowedBranch: "main", githubEnvironment: "production" }
        })
      )
    ).toThrow(/deletionProtection/i);
  });



  it("rejects production without an alarm notification channel", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: true,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: true, alarmNotificationsEnabled: false, alarmEmail: undefined },
          github: { owner: "x", repo: "y", allowedBranch: "main", githubEnvironment: "production" }
        })
      )
    ).toThrow(/alarmNotificationsEnabled/);
  });

  it("rejects production without a protected GitHub environment", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: true,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: true, alarmNotificationsEnabled: true, alarmEmail: "a@b.com" },
          github: { owner: "x", repo: "y", allowedBranch: "main", githubEnvironment: undefined }
        })
      )
    ).toThrow(/githubEnvironment/);
  });

  it("rejects enableCustomDomain without a domain name and hosted zone", () => {
    expect(() =>
      validateEnvironmentConfig(baseConfig({ featureFlags: { enableCustomDomain: true, enableFrontendHosting: false, enableWaf: false } }))
    ).toThrow(/domainName/);
  });

  it("rejects production with alarms turned off", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: true,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: false, alarmNotificationsEnabled: false, alarmEmail: undefined },
          github: { owner: "x", repo: "y", allowedBranch: "main", githubEnvironment: "production" }
        })
      )
    ).toThrow(/production requires observability.alarmsEnabled/);
  });

  it("rejects alarm notifications when alarms are turned off", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({ observability: { enableTracing: true, logRetentionDays: 14, alarmsEnabled: false, alarmNotificationsEnabled: true, alarmEmail: "a@b.com" } })
      )
    ).toThrow(/requires observability.alarmsEnabled/);
  });

  it("rejects alarmNotificationsEnabled without an alarm email", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({ observability: { enableTracing: true, logRetentionDays: 14, alarmsEnabled: true, alarmNotificationsEnabled: true, alarmEmail: undefined } })
      )
    ).toThrow(/alarmEmail/);
  });

  it("rejects a budget whose first-cent alert falls below CloudFormation's 0.1 threshold minimum", () => {
    expect(() =>
      validateEnvironmentConfig(baseConfig({ cost: { monthlyBudgetUsd: 20, alertEmail: "alerts@example.com" } }))
    ).toThrow(/at most 10/);
  });
});
