import { describe, expect, it } from "vitest";
import development from "../../config/development";
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
    operatorMfa: "optional",
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
    github: { owner: "yanivkrispel-cyber", ownerId: 282451313, repo: "Tempo", repoId: 1317067674, allowedBranch: "main", githubEnvironment: undefined },
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

  it("rejects plain-http and localhost origins or callbacks outside development (#124)", () => {
    const https = {
      adminWeb: ["https://console.tempo.example/auth/callback"],
      clientWeb: ["https://app.tempo.example/auth/callback"],
      platformAdminWeb: ["https://ops.tempo.example/auth/callback"]
    };
    const logout = {
      adminWeb: ["https://console.tempo.example/"],
      clientWeb: ["https://app.tempo.example/"],
      platformAdminWeb: ["https://ops.tempo.example/"]
    };
    const staging = (overrides: Partial<TempoEnvironmentConfig>) =>
      baseConfig({ environmentName: "stg", corsAllowedOrigins: ["https://app.tempo.example"], cognitoCallbackUrls: https, cognitoLogoutUrls: logout, ...overrides });

    expect(() => validateEnvironmentConfig(staging({}))).not.toThrow();
    expect(() => validateEnvironmentConfig(staging({ corsAllowedOrigins: ["http://app.tempo.example"] }))).toThrow(/only https/);
    expect(() => validateEnvironmentConfig(staging({ cognitoLogoutUrls: { ...logout, clientWeb: ["https://localhost:5174/"] } }))).toThrow(/never localhost/);
    // Any case, any loopback or unspecified address (#180).
    for (const local of ["https://LOCALHOST:5173", "HTTP://app.tempo.example", "https://[::1]", "https://0.0.0.0", "https://127.0.0.2", "https://app.localhost"]) {
      expect(() => validateEnvironmentConfig(staging({ corsAllowedOrigins: [local] })), local).toThrow(/only https/);
    }
    expect(() => validateEnvironmentConfig(baseConfig())).not.toThrow();
  });

  it("rejects production without deletion protection", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: false,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: true, alarmNotificationsEnabled: true, alarmEmail: "a@b.com" },
          github: { owner: "x", ownerId: 1, repo: "y", repoId: 2, allowedBranch: "main", githubEnvironment: "production" }
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
          github: { owner: "x", ownerId: 1, repo: "y", repoId: 2, allowedBranch: "main", githubEnvironment: "production" }
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
          github: { owner: "x", ownerId: 1, repo: "y", repoId: 2, allowedBranch: "main", githubEnvironment: undefined }
        })
      )
    ).toThrow(/githubEnvironment/);
  });

  it("rejects enableCustomDomain without a domain name and hosted zone", () => {
    expect(() =>
      validateEnvironmentConfig(baseConfig({ featureFlags: { enableCustomDomain: true, enableFrontendHosting: false, enableWaf: false } }))
    ).toThrow(/domainName/);
  });

  it("rejects production with optional operator MFA", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: true,
          operatorMfa: "optional",
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: true, alarmNotificationsEnabled: true, alarmEmail: "a@b.com" },
          github: { owner: "x", ownerId: 1, repo: "y", repoId: 2, allowedBranch: "main", githubEnvironment: "production" }
        })
      )
    ).toThrow(/production requires operatorMfa/);
  });

  it("rejects production with alarms turned off", () => {
    expect(() =>
      validateEnvironmentConfig(
        baseConfig({
          environmentName: "prod",
          enableDeletionProtection: true,
          observability: { enableTracing: true, logRetentionDays: 90, alarmsEnabled: false, alarmNotificationsEnabled: false, alarmEmail: undefined },
          github: { owner: "x", ownerId: 1, repo: "y", repoId: 2, allowedBranch: "main", githubEnvironment: "production" }
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

describe("dev's reserved concurrency fits the account's quota of 40 (case 179192381800130)", () => {
  it("gives the API 20, so parallel e2e runs aren't throttled, and leaves at least 10 unreserved", () => {
    // One API function and one worker (worker-outbox) reserve concurrency; AWS keeps 10 unreserved at least.
    expect(development.lambda.apiReservedConcurrency).toBe(20);
    expect(development.lambda.apiReservedConcurrency + development.lambda.workerReservedConcurrency).toBeLessThanOrEqual(40 - 10);
  });
});
