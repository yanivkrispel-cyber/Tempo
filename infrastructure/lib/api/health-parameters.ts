import { TempoEnvironmentConfig } from "../../config/environment-config";

/**
 * The health declaration's data key (docs/31 section 7, ADR-0026): one SSM
 * SecureString per key version under this prefix, under the account's default
 * aws/ssm key (no customer-managed KMS key, $0). A person writes each version
 * with tools/scripts/health-data-key.mjs; the stacks only name the path.
 */
export function healthDataKeyPrefix(config: TempoEnvironmentConfig): string {
  return `/tempo/${config.environmentName}/health/data-key/`;
}

/** The version new signatures are encrypted with; reads use each row's own version. */
export const HEALTH_DATA_KEY_CURRENT_VERSION = "1";

/**
 * Every version the API may read. A rotation (docs/31 section 7.1) adds the
 * new version here before moving the current one, and drops the old one once
 * no row uses it, so the grant names exact parameters and no wildcard.
 */
export const HEALTH_DATA_KEY_READABLE_VERSIONS = ["1"] as const;
