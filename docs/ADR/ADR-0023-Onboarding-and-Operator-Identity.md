# ADR-0023: Studio Self-Onboarding and a Separate Operator Identity Pool

- **Status:** Accepted
- **Date:** 2026-10-14
- **Owners:** Product owner, Architecture, Security
- **Related:** ADR-0006, ADR-0007, ADR-0021, `docs/26_Identity_Organization_Membership_LLD.md`

## Context

Phase 1 builds accounts, organizations, memberships and invitations. Two questions were open (status page D7 and D8):

1. **Onboarding (D7).** The Phase 0 user pool has `selfSignUpEnabled: true`, while ADR-0007 allows self sign-up only
   when product onboarding needs it. The product decisions say every member signs in to the PWA and books alone, and
   the mockups already show a studio join link and a new-studio wizard.
2. **Operator MFA (D8).** ADR-0007 and LLD section 14.3 make MFA mandatory for platform operators. Cognito sets MFA
   per user pool, and the Phase 0 pool has it optional for everyone, platform-admin client included.

## Decision

### Onboarding

- A studio owner signs up alone (email and password, verified email) and creates their studio. The creator becomes
  the studio's owner.
- Staff and admins join by an invitation bound to their email address.
- Clients join through the studio's join link, or by an invitation.
- Cognito self sign-up stays enabled on the customer pool. A new account has no access to any tenant data until it
  creates a studio or joins one; every grant is made by Tempo, never by Cognito.
- The platform team can still create a studio for a pilot customer and invite its owner.

### Operator identity

- Platform operators (the Tempo team) sign in through a second user pool, `tempo-{env}-operators`:
  - MFA required (TOTP only, no SMS);
  - no self sign-up; accounts are created by an administrator;
  - one app client, `tempo-{env}-platform-admin-web`, which moves out of the customer pool.
- The API trusts both issuers but keeps them apart: tenant endpoints accept only customer-pool tokens, and
  `/api/v1/platform/*` accepts only operator-pool tokens.
- Operators are never organization members (ADR-0006). Their data access goes through a separate database role.

## Alternatives Considered

| Option | Why not |
|---|---|
| Invitation-only onboarding for the pilot | The least work now, but members must self-serve and the self-onboarding flow would be built later anyway. |
| Open sign-up with assignment to a studio afterwards | Needs abuse controls and an assignment screen, and gives a fresh account a state with no clear owner. |
| One pool and a trigger that blocks operators without MFA | Enforcement lives in custom code, where one bug opens platform access; operator and customer sessions share settings. |
| Defer operator MFA until the admin console exists | The console is already in the mockups; the decision would come back within weeks. |

## Cost

$0. Cognito Essentials includes 10,000 monthly active users per account across pools, and TOTP has no message cost.
No Lambda trigger is added. Fits ADR-0021.

## Consequences

- The API validates tokens from two issuers and must map each route to exactly one of them.
- `platform-admin-web` signs in against a different Cognito domain from the other two apps.
- A new database role for platform reads and the few platform writes; its password is an SSM parameter a person
  writes, like the other two.
- The self sign-up path needs abuse limits in Tempo (verified email before creating a studio, a cap on studios per
  account) and, once the edge is on, the WAF rate rule.
- MFA for studio owners stays optional at launch; making it mandatory before the pilot is an open question in the
  Phase 1 LLD.
