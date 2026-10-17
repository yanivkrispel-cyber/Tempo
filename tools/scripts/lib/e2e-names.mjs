// Which logins and studios the e2e cleanup may touch (A-4, docs/32 section 12). Only what an e2e run creates:
// a login `e2e-…@example.com` and a studio whose slug starts with `e2e-`. Anything else is never matched.

const E2E_EMAIL = /^e2e-[a-z0-9-]+@example\.com$/;
const E2E_SLUG = /^e2e-[a-z0-9-]+$/;

/** True only for an e2e login's address, compared in lower case. */
export function isE2eEmail(email) {
  return typeof email === "string" && E2E_EMAIL.test(email.trim().toLowerCase());
}

/** True only for a studio an e2e run opened: its slug starts with `e2e-` (slugs are lower case by the schema). */
export function isE2eStudio(studio) {
  return typeof studio?.slug === "string" && E2E_SLUG.test(studio.slug);
}
