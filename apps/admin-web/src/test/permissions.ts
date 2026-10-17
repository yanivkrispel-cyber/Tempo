/**
 * What GET /me sends for the system roles (docs/27 section 3.1 and docs/29 section 8), for test fixtures: the apps
 * read permissions only from the API.
 */
const scheduling = {
  staff: ["schedule.view", "bookings.manage", "attendance.mark", "passes.view"],
  manager: ["schedule.view", "schedule.manage", "bookings.manage", "attendance.mark", "passes.view", "passes.manage"],
};

export const permissionsFor = {
  owner: [
    "organization.view",
    "organization.settings.manage",
    "members.view",
    "members.invite.staff",
    "members.invite.admin",
    "members.manage",
    "roles.manage",
    "audit.view",
    "people.view",
    "people.manage",
    "people.merge",
    "people.export",
    "people.erase",
    "people.import",
    "people.tags.manage",
    "people.notes.view",
    "people.notes.manage",
    "people.notes.moderate",
    "consent.manage",
    "health.view",
    "ownership.transfer",
    "billing.view",
    "billing.manage",
    ...scheduling.manager,
  ],
  staff: [
    "organization.view",
    "members.view",
    "people.view",
    "people.manage",
    "people.notes.view",
    "people.notes.manage",
    ...scheduling.staff,
  ],
};
