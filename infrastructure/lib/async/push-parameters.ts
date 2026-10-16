import { TempoEnvironmentConfig } from "../../config/environment-config";

/**
 * The web push VAPID key pair (docs/30 section 8). A person writes both values
 * with tools/scripts/vapid-keys.mjs; the stacks only name them. The public key
 * is a plain String parameter, since browsers receive it anyway; the private
 * key is a SecureString under the account's default aws/ssm key (no KMS cost).
 */
const PUSH_PARAMETERS = {
  publicKey: "vapid-public-key",
  privateKey: "vapid-private-key"
} as const;

export function pushParameterName(config: TempoEnvironmentConfig, key: keyof typeof PUSH_PARAMETERS): string {
  return `/tempo/${config.environmentName}/push/${PUSH_PARAMETERS[key]}`;
}

/**
 * The VAPID `sub` claim: a contact for the push services. RFC 8292 allows
 * only `https:` or `mailto:`, so a local-only client origin falls back to the
 * public repository rather than to anyone's address.
 */
export function vapidSubject(config: TempoEnvironmentConfig): string {
  const https = config.cognitoCallbackUrls.clientWeb.find((url) => url.startsWith("https://"));
  return https === undefined ? "https://github.com/yanivkrispel-cyber/Tempo" : new URL(https).origin;
}
