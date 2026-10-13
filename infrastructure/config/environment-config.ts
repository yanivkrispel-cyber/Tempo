/**
 * Typed environment configuration for Tempo AWS infrastructure.
 *
 * Per docs/01_AWS_Infrastructure_LLD.md section 8: configuration is committed,
 * secret values are never stored here, and invalid configuration must fail
 * `cdk synth` via validateEnvironmentConfig().
 */

export type TempoEnvironmentName = "dev" | "stg" | "prod";

export interface AuroraConfig {
  /** Minimum Aurora Serverless v2 capacity units. 0 enables auto-pause where supported. */
  readonly minAcu: number;
  /** Maximum Aurora Serverless v2 capacity units. */
  readonly maxAcu: number;
  /** Whether the writer instance may auto-pause when idle (non-production only). */
  readonly autoPauseEnabled: boolean;
  /** Number of read replicas (0 in the initial phase for every environment). */
  readonly readerCount: number;
  /** Automated backup retention, in days. */
  readonly backupRetentionDays: number;
}

export interface LambdaConfig {
  readonly apiMemoryMb: number;
  readonly apiTimeoutSeconds: number;
  readonly workerMemoryMb: number;
  readonly workerTimeoutSeconds: number;
  /** Reserved concurrency for the API Lambda, bounding Aurora connection pressure. */
  readonly apiReservedConcurrency: number;
  /** Reserved concurrency for each SQS-triggered worker Lambda. */
  readonly workerReservedConcurrency: number;
}

export interface ObservabilityConfig {
  readonly enableTracing: boolean;
  readonly logRetentionDays: number;
  /**
   * Whether CloudWatch alarms are created at all. The ten free alarms are
   * pooled across the whole AWS Organization, so development has none and
   * production keeps them (ADR-0012 amendment, ADR-0021).
   */
  readonly alarmsEnabled: boolean;
  readonly alarmNotificationsEnabled: boolean;
  /** Email subscribed to the alarm SNS topic. Required when alarmNotificationsEnabled is true. */
  readonly alarmEmail?: string;
}

/** Cost guardrails per account (ADR-0020, ADR-0021). */
export interface CostConfig {
  /** Monthly AWS Budget in USD. ADR-0021: $1 in every account until there is revenue. */
  readonly monthlyBudgetUsd: number;
  /** Receives the budget and Cost Anomaly Detection alerts (status page decision D2). */
  readonly alertEmail: string;
}

export interface NetworkingConfig {
  readonly maxAzs: number;
  /** Must default to false. Only enable after an explicit, documented cost/architecture review. */
  readonly natGatewayEnabled: boolean;
}

export interface GitHubDeploymentConfig {
  readonly owner: string;
  readonly repo: string;
  /** Branch permitted to assume the deployment role for this environment, e.g. "main". */
  readonly allowedBranch: string;
  /** Optional GitHub Environment name for protected-environment approval (required for prod). */
  readonly githubEnvironment?: string;
}

export interface FeatureFlags {
  /** Custom Route 53 domain + ACM certificate for the HTTP API. Requires domainName/hostedZoneId. */
  readonly enableCustomDomain: boolean;
  /** Frontend hosting (S3 + CloudFront) - out of scope for the Phase 0 AWS foundation slice. */
  readonly enableFrontendHosting: boolean;
  /** WAF attachment - production-only, deferred until first environment is stable. */
  readonly enableWaf: boolean;
}

export interface TempoEnvironmentConfig {
  readonly environmentName: TempoEnvironmentName;
  readonly accountId: string;
  readonly region: string;

  readonly apiName: string;

  /** Root application domain placeholder. Undefined means no custom domain is configured. */
  readonly domainName?: string;
  readonly hostedZoneId?: string;

  readonly enableDeletionProtection: boolean;

  readonly aurora: AuroraConfig;
  readonly lambda: LambdaConfig;
  readonly observability: ObservabilityConfig;
  readonly cost: CostConfig;
  readonly networking: NetworkingConfig;
  readonly github: GitHubDeploymentConfig;
  readonly featureFlags: FeatureFlags;

  /** Exact, non-wildcard CORS origins allowed to call the HTTP API. */
  readonly corsAllowedOrigins: readonly string[];

  /** Exact, non-wildcard Cognito callback URLs, per app client. */
  readonly cognitoCallbackUrls: {
    readonly adminWeb: readonly string[];
    readonly clientWeb: readonly string[];
    readonly platformAdminWeb: readonly string[];
  };
  readonly cognitoLogoutUrls: {
    readonly adminWeb: readonly string[];
    readonly clientWeb: readonly string[];
    readonly platformAdminWeb: readonly string[];
  };

  readonly tags: {
    readonly owner: string;
    readonly costCenter: string;
  };
}

class EnvironmentConfigError extends Error {
  constructor(errors: readonly string[]) {
    super(`Invalid Tempo environment configuration:\n- ${errors.join("\n- ")}`);
    this.name = "EnvironmentConfigError";
  }
}

/**
 * Validates configuration invariants that must never depend on developer
 * discipline alone - production must not silently inherit unsafe development
 * defaults (LLD section 8, ADR-0020 cost governance, ADR-0005 Aurora).
 */
export function validateEnvironmentConfig(config: TempoEnvironmentConfig): TempoEnvironmentConfig {
  const errors: string[] = [];

  if (!/^\d{12}$/.test(config.accountId)) {
    errors.push(`accountId must be a 12-digit AWS account id, got "${config.accountId}"`);
  }

  if (config.region !== "eu-central-1") {
    errors.push(`region must be "eu-central-1" per ADR-0014, got "${config.region}"`);
  }

  if (config.aurora.minAcu < 0 || config.aurora.maxAcu <= 0) {
    errors.push("aurora.minAcu must be >= 0 and aurora.maxAcu must be > 0");
  }
  if (config.aurora.minAcu > config.aurora.maxAcu) {
    errors.push("aurora.minAcu must not exceed aurora.maxAcu");
  }

  if (config.networking.natGatewayEnabled) {
    errors.push(
      "networking.natGatewayEnabled must be false; NAT Gateway requires explicit ADR-0017 acceptance and review (docs/ADR/ADR-0017)"
    );
  }

  if (config.networking.maxAzs < 2) {
    errors.push("networking.maxAzs must be >= 2 (LLD section 9.1 multi-AZ requirement)");
  }

  if (config.observability.logRetentionDays <= 0) {
    errors.push("observability.logRetentionDays must be > 0 (infinite retention is prohibited)");
  }

  if (config.observability.alarmNotificationsEnabled && !config.observability.alarmEmail) {
    errors.push("observability.alarmEmail is required when alarmNotificationsEnabled is true");
  }
  if (config.observability.alarmNotificationsEnabled && !config.observability.alarmsEnabled) {
    errors.push("observability.alarmNotificationsEnabled requires observability.alarmsEnabled");
  }

  if (!(config.cost.monthlyBudgetUsd > 0)) {
    errors.push("cost.monthlyBudgetUsd must be > 0");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.cost.alertEmail)) {
    errors.push(`cost.alertEmail must be an email address, got "${config.cost.alertEmail}"`);
  }

  for (const url of [
    ...config.corsAllowedOrigins,
    ...config.cognitoCallbackUrls.adminWeb,
    ...config.cognitoCallbackUrls.clientWeb,
    ...config.cognitoCallbackUrls.platformAdminWeb,
    ...config.cognitoLogoutUrls.adminWeb,
    ...config.cognitoLogoutUrls.clientWeb,
    ...config.cognitoLogoutUrls.platformAdminWeb
  ]) {
    if (url.includes("*")) {
      errors.push(`wildcard URLs are prohibited, got "${url}"`);
    }
  }

  if (config.featureFlags.enableCustomDomain && (!config.domainName || !config.hostedZoneId)) {
    errors.push("domainName and hostedZoneId are required when featureFlags.enableCustomDomain is true");
  }

  // Production must never silently inherit unsafe development defaults.
  if (config.environmentName === "prod") {
    if (!config.enableDeletionProtection) {
      errors.push("production requires enableDeletionProtection = true");
    }
    if (config.aurora.autoPauseEnabled) {
      errors.push("production requires aurora.autoPauseEnabled = false");
    }
    if (config.aurora.minAcu <= 0) {
      errors.push("production requires aurora.minAcu > 0");
    }
    if (!config.observability.alarmsEnabled) {
      errors.push("production requires observability.alarmsEnabled = true");
    }
    if (!config.observability.alarmNotificationsEnabled) {
      errors.push("production requires observability.alarmNotificationsEnabled = true");
    }
    if (!config.github.githubEnvironment) {
      errors.push("production requires github.githubEnvironment for protected-environment approval");
    }
  }

  if (errors.length > 0) {
    throw new EnvironmentConfigError(errors);
  }

  return config;
}

export function resourceName(config: TempoEnvironmentConfig, component: string): string {
  return `tempo-${config.environmentName}-${component}`;
}
