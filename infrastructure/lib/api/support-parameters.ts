import { TempoEnvironmentConfig } from "../../config/environment-config";

/**
 * The support contact the console shows under "עזרה ויצירת קשר" (board #584,
 * PL-4): a plain String parameter, an email address or an https link, that a
 * person writes with one command (docs/runbooks/kris-pilot-steps.md). The stack
 * only names it; a missing parameter means no contact is shown.
 */
export function supportContactParameterName(config: TempoEnvironmentConfig): string {
  return `/tempo/${config.environmentName}/support/contact`;
}
