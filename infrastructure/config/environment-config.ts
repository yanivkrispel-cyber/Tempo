/**
 * Typed environment configuration for Tempo AWS infrastructure.
 *
 * Per docs/01_AWS_Infrastructure_LLD.md section 8: configuration is committed,
 * secret values are never stored here, and invalid configuration must fail
 * `cdk synth` via validateEnvironmentConfig().
 */

export type TempoEnvironmentName = "dev" | "stg" | "prod";

/** The environment's Neon project (ADR-0022). The database itself is not a CloudFormation resource. */
export interface NeonConfig {
  /** Neon project id, e.g. `wild-darkness-22822656`. The usage check reads this project. */
  readonly projectId: string;
  /**
   * The production branch's pooled endpoint host (`ep-...-pooler...neon.tech`)
   * and database, for the API's runtime roles. A host name is not a secret;
   * the role passwords stay in SSM. Absent until the project exists.
   */
  readonly pooledHost?: string;
  readonly databaseName?: string;
}

export interface LambdaConfig {
  readonly apiMemoryMb: number;
  readonly apiTimeoutSeconds: number;
  readonly workerMemoryMb: number;
  readonly workerTimeoutSeconds: number;
  /** Reserved concurrency for the API Lambda, bounding database connection pressure. */
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
  /**
   * ARN of an AWS services anomaly monitor that already exists in the account.
   * An account can hold only one AWS services (DIMENSIONAL/SERVICE) monitor, and
   * the management account got `Default-Services-Monitor` when Cost Explorer was
   * enabled there. When set, the baseline subscribes to it instead of creating one.
   */
  readonly existingAnomalyMonitorArn?: string;
}

/** CloudFormation rejects an AWS::Budgets::Budget notification threshold below this (rule F3034). */
const MIN_BUDGET_THRESHOLD = 0.1;

/**
 * The actual-spend alert threshold, as a percent of the budget, that fires on the
 * first cent (ADR-0021). An absolute $0.01 threshold is below CloudFormation's
 * minimum, so the alert is a percentage instead: 1% of a $1 budget.
 */
export function firstCentAlertPercent(monthlyBudgetUsd: number): number {
  return 1 / monthlyBudgetUsd;
}

export interface GitHubDeploymentConfig {
  readonly owner: string;
  readonly repo: string;
  /**
   * Numeric GitHub ids of the owner and the repository. GitHub's immutable OIDC
   * subject (on for this repo) carries them: `repo:<owner>@<ownerId>/<repo>@<repoId>:...`.
   * Read them with `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.
   */
  readonly ownerId: number;
  readonly repoId: number;
  /** Branch permitted to assume the deployment role for this environment, e.g. "main". */
  readonly allowedBranch: string;
  /** Optional GitHub Environment name for protected-environment approval (required for prod). */
  readonly githubEnvironment?: string;
}

export interface FeatureFlags {
  /** Custom Route 53 domain + ACM certificate for the HTTP API. Requires domainName/hostedZoneId. */
  readonly enableCustomDomain: boolean;
  /**
   * The edge stack in us-east-1: one CloudFront distribution for the PWA and,
   * under /api/*, the API function's Function URL, on the CloudFront Free plan
   * (ADR-0004 and ADR-0009 amendments).
   */
  readonly enableFrontendHosting: boolean;
  /** The WAF web ACL on the distribution. The edge stack always attaches it, so it must match enableFrontendHosting. */
  readonly enableWaf: boolean;
  /**
   * The smoke test can sign in as one test user (day board #60, decision 5): the client-web app client also
   * allows ADMIN_USER_PASSWORD_AUTH, which only callers with IAM credentials can use. Never in production.
   */
  readonly enableSmokeTestSignIn?: boolean;
  /**
   * The development canary (Wave Q, Q10): health every 5 minutes, a signed-in tenant read every hour, an email
   * through SNS when two of three checks fail. Needs enableSmokeTestSignIn. Never in production, which has the
   * edge canary.
   */
  readonly enableDevCanary?: boolean;
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

  /**
   * The edge distribution's id (`E...`), set after the edge stack's first deploy (#124 item 8). When set, only that
   * distribution may invoke the API's Function URL; until then any distribution of the account may, because the
   * distribution lives in us-east-1 and naming it from the API stack would be a circular cross-Region reference.
   */
  readonly edgeDistributionId?: string;

  readonly neon: NeonConfig;
  readonly lambda: LambdaConfig;
  readonly observability: ObservabilityConfig;
  readonly cost: CostConfig;
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
 * defaults (LLD section 8, ADR-0020 cost governance).
 */
export function validateEnvironmentConfig(config: TempoEnvironmentConfig): TempoEnvironmentConfig {
  const errors: string[] = [];

  if (!/^\d{12}$/.test(config.accountId)) {
    errors.push(`accountId must be a 12-digit AWS account id, got "${config.accountId}"`);
  }

  if (config.edgeDistributionId !== undefined && !/^E[A-Z0-9]{8,20}$/.test(config.edgeDistributionId)) {
    errors.push(`edgeDistributionId must be a CloudFront distribution id, got "${config.edgeDistributionId}"`);
  }

  if (config.region !== "eu-central-1") {
    errors.push(`region must be "eu-central-1" per ADR-0014, got "${config.region}"`);
  }

  if (!/^[a-z0-9-]+$/.test(config.neon.projectId)) {
    errors.push(`neon.projectId must be a Neon project id, got "${config.neon.projectId}"`);
  }

  if (config.neon.pooledHost !== undefined && !/^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.neon\.tech$/.test(config.neon.pooledHost)) {
    errors.push(`neon.pooledHost must be a Neon pooled endpoint host, got "${config.neon.pooledHost}"`);
  }

  if ((config.neon.pooledHost === undefined) !== (config.neon.databaseName === undefined)) {
    errors.push("neon.pooledHost and neon.databaseName must be set together");
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
  } else if (firstCentAlertPercent(config.cost.monthlyBudgetUsd) < MIN_BUDGET_THRESHOLD) {
    errors.push(
      `cost.monthlyBudgetUsd must be at most ${1 / MIN_BUDGET_THRESHOLD}: the first-cent alert is ` +
        `${firstCentAlertPercent(config.cost.monthlyBudgetUsd)}% of the budget, and CloudFormation ` +
        `rejects budget thresholds below ${MIN_BUDGET_THRESHOLD}`
    );
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
    // Only a developer's machine talks to the API over plain HTTP; staging and production never do (#124).
    if (config.environmentName !== "dev" && !isPublicHttpsUrl(url)) {
      errors.push(`${config.environmentName} allows only https origins and callbacks, never localhost, got "${url}"`);
    }
  }

  if (config.featureFlags.enableWaf !== config.featureFlags.enableFrontendHosting) {
    errors.push("featureFlags.enableWaf must equal enableFrontendHosting: the edge stack always attaches the web ACL, which the Free plan covers");
  }

  if (config.featureFlags.enableCustomDomain && (!config.domainName || !config.hostedZoneId)) {
    errors.push("domainName and hostedZoneId are required when featureFlags.enableCustomDomain is true");
  }

  // Production must never silently inherit unsafe development defaults.
  if (config.environmentName === "prod") {
    if (!config.enableDeletionProtection) {
      errors.push("production requires enableDeletionProtection = true");
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
    if (config.featureFlags.enableDevCanary) {
      errors.push("production must not enable featureFlags.enableDevCanary");
    }
    if (config.featureFlags.enableSmokeTestSignIn) {
      errors.push("production must not enable featureFlags.enableSmokeTestSignIn");
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

/** An https URL whose host is not this machine: no localhost, loopback or unspecified address, in any case (#180). */
function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // URL lowercases the scheme and the host.
  const host = parsed.hostname;
  const local = host === "localhost" || host.endsWith(".localhost") || host.startsWith("127.") || host === "0.0.0.0" || host === "[::1]" || host === "[::]";
  return parsed.protocol === "https:" && !local;
}
