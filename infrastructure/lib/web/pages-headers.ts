import { TempoEnvironmentConfig } from "../../config/environment-config";
import { appContentSecurityPolicy } from "../edge/edge-stack";

/**
 * The `_headers` file Cloudflare Pages serves with the web apps (ADR-0027). It carries the same headers CloudFront
 * would: the apps' Content-Security-Policy (#133) and the managed SecurityHeadersPolicy (HSTS, nosniff, frame
 * options, referrer policy). The API is not same-origin there, so its origin joins connect-src.
 */
export function pagesHeadersFile(config: TempoEnvironmentConfig, apiUrl: string): string {
  const apiOrigin = new URL(apiUrl).origin;
  if (!apiOrigin.startsWith("https://")) {
    throw new Error(`the API URL must be https, got "${apiUrl}"`);
  }
  const headers = [
    `Content-Security-Policy: ${appContentSecurityPolicy(config, [apiOrigin])}`,
    "Strict-Transport-Security: max-age=31536000",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: SAMEORIGIN",
    "Referrer-Policy: strict-origin-when-cross-origin"
  ];
  return ["/*", ...headers.map((header) => `  ${header}`), ""].join("\n");
}
