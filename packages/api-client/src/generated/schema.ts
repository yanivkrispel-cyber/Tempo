// Generated from contracts/openapi/tempo-api.v1.yaml by `pnpm --filter @tempo/api-client generate`.
// Do not edit by hand: CI fails when this file differs from the contract.

export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness check */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create or refresh the caller's Tempo account
         * @description Call once after every sign-in. Creates the account on first use and refreshes email and
         *     verification from Cognito. Idempotent.
         */
        post: operations["startSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The caller's account and studios */
        get: operations["getMe"];
        put?: never;
        post?: never;
        /**
         * Delete my login (recent sign-in, typed confirmation)
         * @description docs/32 section 9 (A-1, A-2). In one transaction every membership ends, the account row is removed and each
         *     studio's person record is detached from the login and kept: its bookings, passes and attendance are the
         *     studio's record (the person can ask the studio to erase it). Then the sign-in user is deleted. The audit
         *     records `account.deleted` without the email. While the caller is the only active owner of a studio the
         *     answer is 409 `account.sole_owner`, with that studio's id in `organizationIds`: transfer ownership first.
         */
        delete: operations["deleteMe"];
        options?: never;
        head?: never;
        /** Update display name or locale */
        patch: operations["updateMe"];
        trace?: never;
    };
    "/api/v1/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Open a new studio; the caller becomes its owner
         * @description Needs a verified email. At most 3 studios per account (`organization.creation_limit`).
         */
        post: operations["createOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Show what an invitation is for, without accepting it */
        post: operations["previewInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept an invitation
         * @description The caller's verified email must match the invitation. Accepting twice returns the same membership.
         */
        post: operations["acceptInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/join/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Show which studio a join link belongs to */
        post: operations["previewJoin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/join": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Join a studio as a client through its join link */
        post: operations["joinOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** A studio the caller belongs to */
        get: operations["getOrganization"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change studio settings (owner, admin) */
        patch: operations["updateOrganization"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's members (owner, admin, staff) */
        get: operations["listMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/members/{membershipId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                membershipId: components["parameters"]["MembershipId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a member, or leave the studio when it is your own membership
         * @description The owner cannot leave (`membership.owner_cannot_leave`).
         */
        delete: operations["removeMember"];
        options?: never;
        head?: never;
        /**
         * Change a member's role or suspend and reactivate them
         * @description Owners can change anyone but themselves; admins only staff and clients. The owner role cannot be
         *     granted here (`membership.forbidden_role_change`).
         */
        patch: operations["updateMember"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Pending and past invitations (owner, admin) */
        get: operations["listInvitations"];
        put?: never;
        /**
         * Invite someone by email (owner, admin)
         * @description Returns the invitation link once; it is not stored and cannot be shown again. Until Tempo can send
         *     email, the inviter shares the link (LLD open question O-1). A new invitation to the same email
         *     revokes the previous pending one. Admins cannot invite admins.
         */
        post: operations["createInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/invitations/{invitationId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                invitationId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a pending invitation (owner, admin) */
        delete: operations["revokeInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/join-link": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Create the studio's join link, or replace it (owner, admin)
         * @description The previous link stops working at once. The link is returned only here.
         */
        put: operations["rotateJoinLink"];
        post?: never;
        /** Turn the join link off (owner, admin) */
        delete: operations["disableJoinLink"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's audit log, newest first (owner, admin) */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** All studios */
        get: operations["platformListOrganizations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** One studio, with its owner and member counts (audited) */
        get: operations["platformGetOrganization"];
        put?: never;
        post?: never;
        /**
         * Remove a suspended studio and every row it owns (audited, recent sign-in)
         * @description docs/32 section 10 (A-3). Only a studio suspended for at least the configured days (0 on dev, 30 on prod).
         *     Every tenant row goes in one transaction, health declarations and push subscriptions included; the audit
         *     keeps `platform.organization.deleted` with the id and name only.
         */
        delete: operations["platformDeleteOrganization"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Suspend a studio */
        post: operations["platformSuspendOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reactivate a suspended studio */
        post: operations["platformReactivateOrganization"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Counts for the console home page */
        get: operations["platformGetStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/profile": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * The caller's own person record in this studio, with contacts and consent
         * @description Any active member. Uses the self rule, so no `people.*` permission is needed.
         */
        get: operations["getMyProfile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit the caller's own name and birth date in this studio */
        patch: operations["updateMyProfile"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/consents": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Grant or withdraw one of the caller's own consents
         * @description Appends a row with `method = self`; the current state is the latest row (docs/27 section 4.3).
         */
        post: operations["recordMyConsent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * The roles a member can hold in this studio (`members.view`)
         * @description The four system roles, plus the studio's custom roles once they exist (system roles only in Phase 2, A-1).
         */
        get: operations["listRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The permission catalog, for the role screen (`roles.manage`) */
        get: operations["listPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/members/{membershipId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                membershipId: components["parameters"]["MembershipId"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Replace a member's full set of roles (`members.manage` or `roles.manage`)
         * @description The rank rule applies: without `roles.manage` you can assign only roles whose permissions you hold
         *     yourself (`role.exceeds_actor`). Nobody can assign `owner` (`membership.forbidden_role_change`); use an
         *     owner transfer. Nobody can change their own roles. Granting `admin` needs a recent sign-in
         *     (`auth.step_up_required`).
         */
        put: operations["setMemberRoles"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/ownership-transfer": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The pending owner transfer, if any (owner, or its target) */
        get: operations["getOwnershipTransfer"];
        put?: never;
        /**
         * Offer the studio to an active admin (`ownership.transfer`, recent sign-in)
         * @description The target accepts within 72 hours. One pending transfer per studio (`ownership.transfer_pending`).
         */
        post: operations["startOwnershipTransfer"];
        /** Cancel the pending transfer (the owner) */
        delete: operations["cancelOwnershipTransfer"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/ownership-transfer/accept": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept the studio (the target member)
         * @description In one transaction the caller becomes `owner` and the previous owner becomes `admin`.
         */
        post: operations["acceptOwnershipTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/ownership-transfer/decline": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Decline the studio (the target member) */
        post: operations["declineOwnershipTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's person records (`people.view`) */
        get: operations["listPeople"];
        put?: never;
        /**
         * Record a person without a login, e.g. a walk-in (`people.manage`)
         * @description Needs a display name and at least one phone or email (P-6). Possible duplicates are flagged, never merged.
         */
        post: operations["createPerson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** One person with contacts, current consent and relationships (`people.view`) */
        get: operations["getPerson"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit a person's name, birth date or status (`people.manage`) */
        patch: operations["updatePerson"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/contact-points": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add an email or phone (`people.manage`)
         * @description Israeli local phones (`050-1234567`) are stored as E.164; an invalid number is `contact_point.invalid_phone`.
         */
        post: operations["addContactPoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/contact-points/{contactPointId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                contactPointId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a contact (`people.manage`) */
        delete: operations["deleteContactPoint"];
        options?: never;
        head?: never;
        /**
         * Change a contact's value or make it primary (`people.manage`)
         * @description A verified contact (the login's email) cannot be edited here.
         */
        patch: operations["updateContactPoint"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/consents": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** Every consent row for a person, newest first (`people.view`) */
        get: operations["listConsentHistory"];
        put?: never;
        /**
         * Record consent from a paper form (`consent.manage`)
         * @description Appends a row with `method = staff_on_behalf`.
         */
        post: operations["recordConsentOnBehalf"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/relationships": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Link this person to another, e.g. guardian of a child (`people.manage`) */
        post: operations["addRelationship"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/relationships/{relationshipId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                relationshipId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a link (`people.manage`) */
        delete: operations["deleteRelationship"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/invite": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Invite a recorded person to the app as a client (`members.invite.staff`)
         * @description Creates an invitation that carries `personId`, so accepting it links the login to this record instead of
         *     creating a new one. The person must have no login (`person.has_login`). The link is shown once.
         */
        post: operations["invitePerson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/export": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Everything the studio holds about one person, as JSON (`people.export`, recent sign-in) */
        post: operations["exportPerson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/erase": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Anonymize a person (`people.erase`, recent sign-in)
         * @description Names, contacts and birth date are removed, the login is unlinked and `status` becomes `anonymized`.
         *     Consent states and timestamps stay as proof. Cannot be undone.
         */
        post: operations["erasePerson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/import": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check or import people from a file the console has read (`people.import`)
         * @description docs/34 sections 3 to 6. The console reads the CSV file in the browser and sends its rows; the file never
         *     reaches the server. At most 1,000 rows (more is 400 `import.too_many_rows`). Every row gets one outcome:
         *     `valid` (dry run) or `created`; `exists` (a person in this studio already has that email or phone, nothing
         *     changes); `duplicate_in_file` (an earlier row has the same email or phone); `invalid` (with `field` and
         *     `code`). `dryRun: true` writes nothing. `dryRun: false` creates every `created` row in one transaction with
         *     `source = import`; an invalid row never blocks the others. No consent is recorded and nothing is sent.
         */
        post: operations["importPeople"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/tags": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's tags, by name, with how many people have each (`people.view`) */
        get: operations["listTags"];
        put?: never;
        /**
         * Add a tag (`people.tags.manage`)
         * @description A name already used in the studio, ignoring case, is 409 `tag.name_taken`; a 101st tag is 409 `tag.limit_reached`.
         */
        post: operations["createTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a tag and take it off everyone (`people.tags.manage`) */
        delete: operations["deleteTag"];
        options?: never;
        head?: never;
        /** Rename or recolour a tag (`people.tags.manage`) */
        patch: operations["updateTag"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put a tag on a person (`people.manage`)
         * @description Putting a tag the person already has changes nothing (200). A 21st tag on one person is 409 `person.tag_limit_reached`.
         */
        post: operations["tagPerson"];
        /** Take a tag off a person (`people.manage`) */
        delete: operations["untagPerson"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** Staff notes on a person, newest first (`people.notes.view`) */
        get: operations["listPersonNotes"];
        put?: never;
        /**
         * Add a staff note (`people.notes.manage`)
         * @description Plain text, 1 to 1,000 characters. Not for health information (docs/34 section 8). The person gets notes in their export.
         */
        post: operations["addPersonNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/notes/{noteId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                noteId: components["parameters"]["NoteId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a note: your own (`people.notes.manage`) or anyone's (`people.notes.moderate`) */
        delete: operations["deletePersonNote"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/duplicate-candidates": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Pairs of people that may be the same human (`people.merge`) */
        get: operations["listDuplicateCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/duplicate-candidates/{candidateId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                candidateId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge the pair into one record, or mark it as two people (`people.merge`)
         * @description Two records that both have a login cannot be merged (`person.merge_both_have_login`).
         */
        post: operations["resolveDuplicateCandidate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/force-owner-transfer": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Make an active admin the owner when the owner is unreachable (audited) */
        post: operations["platformForceOwnerTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/rooms": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's rooms (`schedule.view`) */
        get: operations["listRooms"];
        put?: never;
        /** Add a room (`schedule.manage`, limit `rooms.max`) */
        post: operations["createRoom"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/rooms/{roomId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Rename, resize or archive a room (`schedule.manage`) */
        patch: operations["updateRoom"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/rooms/{roomId}/layout": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        /**
         * A room's spots: grid, window, mirror (`schedule.view`)
         * @description docs/33 section 3. Archived spots are left out.
         */
        get: operations["getRoomLayout"];
        /**
         * Replace a room's layout (`schedule.manage`)
         * @description The whole layout in one request (docs/33 section 3.2). A spot with an `id` keeps its bookings; a spot without
         *     one is new; an existing spot left out is retired. 409 `room.spot_in_use` when a spot leaving service holds a
         *     place in a future class, 409 `room.spots_below_booked` when a future class has more places booked than the
         *     active spots. With `spotSelection` on, future places without a spot get one (usual spot first); turning it
         *     off clears the spots of future places.
         */
        put: operations["saveRoomLayout"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}/spots": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /**
         * The room map of one class (`schedule.view`)
         * @description Every active or maintenance spot with its state for the caller: `free`, `taken`, `mine` or `maintenance`
         *     (docs/33 section 3.4). A member never sees who holds another spot. Staff with `bookings.manage` and the
         *     class's instructor also get `bookingId`, `person`, `attendance` (the booking status) and `healthStatus`.
         *     A class whose room has no spot selection answers `spotSelection: false` and no spots.
         */
        get: operations["getSessionSpots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/bookings/{bookingId}/spot": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Change the spot of a booked place (self before the class, or `bookings.manage`)
         * @description 409 `booking.spot_unavailable` when the spot is taken, under maintenance or not in the class's room.
         */
        put: operations["changeBookingSpot"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/spot-preferences/{roomId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        get?: never;
        /**
         * Set or clear the caller's usual spot in a room (self)
         * @description A booking without a chosen spot takes the usual spot when it is free (docs/33 X-3).
         */
        put: operations["setUsualSpot"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/buddy-code": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A new one-time buddy code to share (self)
         * @description Replaces the caller's previous code. The code is shown once, lives 48 hours and links once (docs/33
         *     section 4, D18). Whoever enters it becomes the caller's buddy: each then sees the other on room maps.
         */
        post: operations["createBuddyCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/buddies": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The caller's buddies (self) */
        get: operations["listMyBuddies"];
        put?: never;
        /**
         * Become buddies by entering a friend's code (self)
         * @description 404 `buddy.invalid_code` for a wrong or expired code (counted: five in an hour answer 429
         *     `buddy.too_many_attempts`), 409 `buddy.self` for one's own code, 409 `buddy.limit` past 20 buddies.
         */
        post: operations["linkBuddy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/buddies/{personId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Stop being buddies (either side) */
        delete: operations["unlinkBuddy"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/class-types": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's class types (`schedule.view`) */
        get: operations["listClassTypes"];
        put?: never;
        /** Add a class type (`schedule.manage`, limit `class_types.max`) */
        post: operations["createClassType"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/class-types/{classTypeId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                classTypeId: components["parameters"]["ClassTypeId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit or archive a class type (`schedule.manage`) */
        patch: operations["updateClassType"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/schedule-templates": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Weekly classes (`schedule.manage`) */
        get: operations["listScheduleTemplates"];
        put?: never;
        /** Add a weekly class; sessions appear for the next eight weeks (`schedule.manage`) */
        post: operations["createScheduleTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/schedule-templates/{templateId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                templateId: components["parameters"]["TemplateId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change or end a weekly class (`schedule.manage`)
         * @description Applies to future sessions without live bookings. Sessions that have bookings keep their values and are listed in `untouchedSessions`.
         */
        patch: operations["updateScheduleTemplate"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Sessions in a date range (`schedule.view`) */
        get: operations["listSessions"];
        put?: never;
        /** Add a one-off session (`schedule.manage`) */
        post: operations["createSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /** One session with the caller's booking state (`schedule.view`) */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change one session's instructor, room or capacity (`schedule.manage`)
         * @description Capacity cannot go below the number booked (409 `session.capacity_below_booked`). Raising it promotes from the waitlist.
         */
        patch: operations["updateSession"];
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a session: every booking is cancelled and its entry returned (`schedule.manage`) */
        post: operations["cancelSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}/roster": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /** Booked and waiting people (`bookings.manage`, or the session's instructor) */
        get: operations["getSessionRoster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * A short text to everyone registered on a class (`bookings.manage`, or the session's instructor)
         * @description Reaches every `booked` and `waitlisted` person as an inbox item of kind `session.message` that carries the
         *     text (`InboxItem.text`). The audit log records that a message went out and to how many people, never the
         *     text. At most 5 messages per class per hour (409 `session.message_limit`); a cancelled class, or one that
         *     ended more than a day ago, answers 409 `booking.closed`. No push, SMS or email in this step (docs/30).
         */
        post: operations["sendSessionMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/sessions/{sessionId}/bookings": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Book a place, or join the waitlist when full (self, or `bookings.manage` with `personId`)
         * @description Takes one entry from the person's pass (docs/29 section 5.3). A full session puts the booking on the waitlist (`status: waitlisted`) without taking an entry. 409 codes: `booking.duplicate`, `booking.closed`, `booking.not_open`, `booking.no_valid_pass` (with `frozenUntil` when the membership is frozen that day), `session.full` (waitlist off or past its cutoff), `session.cancelled`.
         */
        post: operations["createBooking"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/bookings/{bookingId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel a booking or leave the waitlist (self, or `bookings.manage`)
         * @description Inside the free-cancellation window the entry returns; later it stays used and `lateCancel` is true. `returnEntry` (staff only) returns it anyway. Allowed in restricted mode.
         */
        post: operations["cancelBooking"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/bookings/{bookingId}/move": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move a booked place to another class (`bookings.manage`)
         * @description The entry moves with the place: nothing is spent or returned. The old row becomes `cancelled` with
         *     `cancelReason: moved` (never a late cancel) and the old class promotes its waitlist. A full target answers
         *     409 `session.full` (a move never joins a waitlist); a pass that does not cover the target answers 409
         *     `booking.no_valid_pass`; a place that is not `booked` answers 409 `booking.not_cancellable`. Returns the
         *     **new** booking. The member gets an inbox item of kind `booking.moved`.
         */
        post: operations["moveBooking"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/bookings/{bookingId}/attendance": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark attended or no-show (`attendance.mark`, or the session's instructor) */
        post: operations["markAttendance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/bookings": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The caller's bookings in this studio (self) */
        get: operations["listMyBookings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/bookings/{bookingId}/calendar.ics": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        /**
         * Add to calendar: an iCalendar file for the caller's own booked place (self)
         * @description One `VEVENT` (RFC 5545): `UID` is `{bookingId}@tempo`, times in UTC, `SUMMARY` the class name, `LOCATION`
         *     the studio and the room, `DESCRIPTION` one Hebrew line. Sent as an attachment named `tempo-{localDate}.ics`.
         *     Only a `booked` or `attended` place of the caller; anything else answers 404. Cancelling later does not
         *     update the calendar entry (no `METHOD:CANCEL` without email, docs/30).
         */
        get: operations["getBookingCalendar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/bookings": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** One person's bookings (`bookings.manage`) */
        get: operations["listPersonBookings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/pass-products": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Punch cards and memberships the studio sells (`passes.view`) */
        get: operations["listPassProducts"];
        put?: never;
        /** Add a punch card or membership product (`passes.manage`) */
        post: operations["createPassProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/pass-products/{productId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stop selling a product; granted passes keep working (`passes.manage`) */
        post: operations["archivePassProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/passes": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** One person's passes, newest first (`passes.view`) */
        get: operations["listPersonPasses"];
        put?: never;
        /** Grant a pass, e.g. paid at the desk (`passes.manage`) */
        post: operations["grantPass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/passes/{passId}/void": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Void a pass; sessions already booked keep their entry (`passes.manage`) */
        post: operations["voidPass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/passes/{passId}/freezes": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Freeze a period membership for a date range (`passes.manage`)
         * @description Studio dates, inclusive, 1 to 90 days, starting today or later and before the membership ends. `endsOn` of
         *     the pass moves out by the frozen days; no booking inside them (the member sees 409 `booking.no_valid_pass`);
         *     bookings already made inside the period stay (C-11). The member gets an inbox item `pass.frozen`.
         *     400 codes (`errors`): `startsOn.invalid` (missing, or before today), `endsOn.invalid` (missing, before
         *     `startsOn`, or more than 90 days). 404: `pass.not_found`. 409 codes: `pass.not_freezable` (a punch card,
         *     C-12), `pass.voided`, `pass.freeze_outside` (starts after the membership ends), `pass.freeze_overlap`.
         */
        post: operations["freezePass"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/passes/{passId}/freezes/{freezeId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
                freezeId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a freeze that has not started; validity shrinks back (`passes.manage`)
         * @description 404 codes: `pass.not_found`, `pass.freeze_not_found`. 409 codes: `pass.freeze_started` (a freeze that already started stays), `pass.freeze_has_bookings` (booked or waiting places fall in the days removing it would take off the end; `bookings` gives their count, never the people; move or cancel them first), `pass.voided`, `pass.not_freezable`.
         */
        delete: operations["unfreezePass"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/passes": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The caller's passes in this studio (self) */
        get: operations["listMyPasses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/booking-policy": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Cancellation window, waitlist cutoff, booking horizon (`schedule.view`) */
        get: operations["getBookingPolicy"];
        /** Change the booking policy (`schedule.manage`) */
        put: operations["updateBookingPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The caller's in-app notifications in this studio, newest first (self) */
        get: operations["listMyNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark all of the caller's notifications in this studio read (self) */
        post: operations["markAllNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/notifications/{itemId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                itemId: components["parameters"]["ItemId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark one notification read (self) */
        post: operations["markNotificationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/notification-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * The caller's notification channels, reminder switches and quiet hours in this studio (self)
         * @description Defaults apply when the member never saved (docs/30 sections 5 and 7): inbox and push on for every group, every reminder the studio offers on, quiet hours null (the studio's window applies).
         */
        get: operations["getMyNotificationPreferences"];
        /**
         * Save the caller's notification preferences in this studio (self)
         * @description The inbox cannot be switched off, and the `bookings` group (service notices about the member's own bookings) keeps at least the inbox: `inbox: false` answers 400 `preferences.inbox_required`. Quiet hours are two local times in the studio's time zone; equal times answer 400 `quietHours.invalid`.
         */
        put: operations["updateMyNotificationPreferences"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/push-subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The caller's devices that receive push from this studio (self) */
        get: operations["listMyPushSubscriptions"];
        put?: never;
        /**
         * Register this browser's push subscription for this studio (self)
         * @description The body is the browser's `PushSubscription.toJSON()` plus a device label. Registering an endpoint that is already registered for the caller in this studio returns the existing subscription with 200 (idempotent). The endpoint must be a browser push service over `https://` (FCM, Mozilla autopush, WNS, Apple); anything else answers 400 `push.endpoint_invalid`. Keys that do not decode to a P-256 point and a 16-byte secret answer 400 `push.keys_invalid`. A member keeps at most 10 devices per studio; registering an eleventh drops the oldest. A subscription the push service later reports gone (404 or 410) is deleted by the server.
         */
        post: operations["createMyPushSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/push-subscriptions/{subscriptionId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                subscriptionId: components["parameters"]["SubscriptionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Stop push to one of the caller's devices (self) */
        delete: operations["deleteMyPushSubscription"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/push/vapid-public-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment's VAPID public key, for PushManager.subscribe (any signed-in account)
         * @description The same key for every studio in the environment (docs/30 section 4.3). It changes only when the key pair is rotated, after which every browser subscribes again. Before the key pair is set up in an environment the route answers 404 `push.unavailable`; the app then hides the push switch.
         */
        get: operations["getVapidPublicKey"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/notification-settings": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * The studio's quiet hours and reminder timing (`organization.view`)
         * @description Defaults until the studio saves (docs/30 D-4, D-5).
         */
        get: operations["getNotificationSettings"];
        /**
         * Change the studio's quiet hours and reminder timing (`organization.settings.manage`)
         * @description A reminder switched off here is off for every member; one switched on is on for members who did not switch it off. Out-of-range values answer 400 with the field in `errors`. Equal quiet-hour times answer 400 `quietHours.invalid`.
         */
        put: operations["updateNotificationSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/notification-templates": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * Every kind a studio can word, by group, and whether it has its own words (`organization.settings.manage`)
         * @description One row per templated kind of docs/30 section 5. `session.message` and `studio.announcement` carry the staff's own text and have no template.
         */
        get: operations["listNotificationTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/notification-templates/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                /** @description A templated kind, e.g. `booking.promoted`; any other answers 404 `template.kind_unknown`. */
                kind: string;
            };
            cookie?: never;
        };
        /** The words in use for one kind, with its variables and a preview on the demo studio's data (`organization.settings.manage`) */
        get: operations["getNotificationTemplate"];
        /**
         * Save the studio's words for one kind, or go back to the default (`organization.settings.manage`)
         * @description Each channel saved becomes the studio's new active version (the previous one is kept as `retired`); `null` retires the studio's version so the platform default applies again. Audited as `template.changed` with the kind, locale, channel and version, never the text. 400 `template.unknown_variable` names the field (`inbox.subject`, `push.body`, ...) and the `variable`; 400 `template.invalid` for an empty or too long text. 409 `concurrency.conflict` when `If-Match` is stale. The next notification of the kind uses the new words.
         */
        put: operations["updateNotificationTemplate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** Who an announcement would reach now and how many are left today (`bookings.manage`) */
        get: operations["getAnnouncementAllowance"];
        put?: never;
        /**
         * Send a studio announcement to every active member (`bookings.manage`)
         * @description One `studio.announcement` inbox item per active member, through the members' preferences and quiet hours (docs/30 section 7). At most 3 a day per studio (429 `announcement.daily_limit` with `dailyLimit` and `Retry-After` until the studio's next midnight) and at most 500 recipients (409 `announcement.too_many_recipients` with `recipients` and `maxRecipients`; nothing is sent). The text is Markdown-light without variables; the inbox shows it as written, and push carries only the kind and ids. Audited as `announcement.sent` with the recipient count, never the text.
         */
        post: operations["sendAnnouncement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /**
         * A person's last 30 delivery lines, newest first (`people.view`)
         * @description Kind, channel, status, reason and times only; never the text or the address (docs/30 D-6).
         */
        get: operations["listPersonDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/health-declaration": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * My declaration's status, the current form, and whether the studio requires it (self)
         * @description No answers and no names (docs/31 section 9); the member's copy of those is in the export.
         */
        get: operations["getMyHealthDeclaration"];
        put?: never;
        /**
         * Sign the current form, for myself or as a guardian (self); replaces my current declaration
         * @description `signedName` is the member's full name (whose declaration it is); `guardianName` is the guardian who signs,
         *     only for `signerRole: guardian`. 400 `health.answers_incomplete`, `health.confirmation_required`,
         *     `health.signed_name_invalid`, `health.guardian_name_required`; 409 `health.form_version_stale` (reload the
         *     form); 503 `health.key_unavailable`.
         */
        post: operations["signMyHealthDeclaration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/health-declaration": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /** A person's declaration status and dates, no answers (`people.view`) */
        get: operations["getPersonHealthDeclaration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/health-declaration/answers": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        /**
         * A person's current answers and signer names (`health.view`; every read is audited)
         * @description Writes `health.declaration.viewed` (no content). Sent with `Cache-Control: no-store`; apps must not cache
         *     it. 404 `health.declaration_not_found` when the status is `missing`; 503 `health.key_unavailable`.
         */
        get: operations["getPersonHealthDeclarationAnswers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/people/{personId}/health-declaration/medical-approval": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record that a doctor's approval was received (`health.view`); `needs_medical_approval` becomes `signed`
         * @description 409 `health.no_approval_needed` when the status is not `needs_medical_approval`.
         */
        post: operations["recordMedicalApproval"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/progress": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * My visits this month, my monthly goal and my streak of weeks in this studio (self)
         * @description Only attended classes count, by the session's start in the studio's time zone (docs/31 section 12).
         */
        get: operations["getMyProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/me/progress/goal": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        /** Set my monthly goal (1 to 31), or clear it with null (self) */
        put: operations["setMyMonthlyGoal"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/reports/summary": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * Weekly figures, per class type and members for a period (`reports.view`)
         * @description docs/32 sections 4 and 5. `from` and `to` are dates in the studio's time zone, both included, at most 92
         *     days. Without both, the last 4 full Sunday-to-Saturday weeks before today. Only sessions that have started
         *     count. No names and no health data.
         */
        get: operations["getReportSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/reports/passes-ending": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * Passes that end within 14 days or have one entry left (`reports.view` and `people.view`)
         * @description docs/32 section 6. At most 50 rows, the soonest first; `truncated` says more exist.
         */
        get: operations["listPassesEnding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/reports/members-at-risk": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /**
         * Members with a valid pass and no attended class for 30 days (`reports.view` and `people.view`)
         * @description docs/32 section 6. At most 50 rows, the longest absence first; `truncated` says more exist.
         */
        get: operations["listMembersAtRisk"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/billing": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        /** The studio's plan, subscription state and billing details (`billing.view`) */
        get: operations["getBilling"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{organizationId}/billing/account": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Billing email, legal name, business id (`billing.manage`) */
        patch: operations["updateBillingAccount"];
        trace?: never;
    };
    "/api/v1/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public plans and their entitlements (any signed-in account) */
        get: operations["listPlans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/billing/plan": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        /** Move a studio to a plan version (audited) */
        put: operations["platformSetPlan"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/billing/payments": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Record a manual payment (audited) */
        post: operations["platformRecordPayment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/platform/organizations/{organizationId}/billing/overrides/{entitlementKey}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                entitlementKey: components["parameters"]["EntitlementKey"];
            };
            cookie?: never;
        };
        get?: never;
        /** Override one entitlement for one studio (audited) */
        put: operations["platformSetEntitlementOverride"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Problem: {
            type: string;
            title: string;
            status: number;
            /**
             * @description Stable machine-readable code, e.g. `membership.not_found`.
             * @example organization.not_found
             */
            code: string;
            detail?: string;
            correlationId: string;
            errors?: {
                field: string;
                code: string;
                message?: string;
            }[];
            /**
             * Format: date
             * @description On `booking.no_valid_pass` only, when the person's membership is frozen on that day (docs/29 section 16.4).
             */
            frozenUntil?: string;
            /** @description On `account.sole_owner` only, the studios where the caller is the only owner (docs/32 section 9). */
            organizationIds?: string[];
            /**
             * Format: date-time
             * @description On `organization.suspended_too_recently` only, when the studio can be removed (docs/32 section 10).
             */
            deletableFrom?: string;
        };
        Health: {
            /** @example healthy */
            status: string;
            environment: string;
            version: string;
            /** Format: date-time */
            timestamp: string;
            correlationId: string;
        };
        /** @enum {string} */
        Role: "owner" | "admin" | "staff" | "client";
        /** @enum {string} */
        MembershipStatus: "invited" | "active" | "suspended" | "removed";
        /** @enum {string} */
        OrganizationStatus: "active" | "suspended";
        /** @enum {string} */
        InvitationStatus: "pending" | "accepted" | "revoked" | "expired";
        /** @enum {string} */
        InvitableRole: "admin" | "staff" | "client";
        Me: {
            /** Format: uuid */
            id: string;
            /** Format: email */
            email: string;
            emailVerified: boolean;
            displayName?: string | null;
            /** @example he-IL */
            locale: string;
            /** @enum {string} */
            status: "active" | "disabled";
            memberships: components["schemas"]["MyMembership"][];
        };
        /** @description One studio the caller belongs to, for the studio switcher. */
        MyMembership: {
            /** Format: uuid */
            membershipId: string;
            /**
             * @deprecated
             * @description Phase 1 field, kept one release. Read `roles` and `permissions` instead.
             */
            role: components["schemas"]["Role"];
            roles: components["schemas"]["RoleSummary"][];
            /** @description The union of the permissions of the caller's live roles in this studio. */
            permissions: components["schemas"]["PermissionKey"][];
            pendingOwnershipTransfer?: components["schemas"]["PendingOwnershipTransfer"] | null;
            status: components["schemas"]["MembershipStatus"];
            /** @description The studio's subscription state (docs/28), for banners and restricted mode. */
            subscriptionState?: components["schemas"]["SubscriptionState"] | null;
            /** @description The studio's entitlements (docs/28), to hide or upsell features. */
            entitlements?: components["schemas"]["Entitlements"] | null;
            organization: {
                /** Format: uuid */
                id: string;
                slug: string;
                displayName: string;
                status: components["schemas"]["OrganizationStatus"];
            };
        };
        UpdateMeRequest: {
            displayName?: string;
            /** @enum {string} */
            locale?: "he-IL" | "en-US";
        };
        /**
         * @description Lowercase Latin letters, digits and hyphens, 3 to 40 characters.
         * @example studio-neshima
         */
        Slug: string;
        Organization: {
            /** Format: uuid */
            id: string;
            slug: components["schemas"]["Slug"];
            /** @example סטודיו נשימה */
            displayName: string;
            status: components["schemas"]["OrganizationStatus"];
            /** @example IL */
            countryCode: string;
            /** @example he-IL */
            defaultLocale: string;
            /** @example Asia/Jerusalem */
            timeZone: string;
            /** @example ILS */
            currencyCode: string;
            joinLinkEnabled: boolean;
            /** Format: date-time */
            createdAt: string;
            /** @description Send back in `If-Match` when updating. */
            version: string;
        };
        CreateOrganizationRequest: {
            displayName: string;
            slug: components["schemas"]["Slug"];
            /** @default Asia/Jerusalem */
            timeZone: string;
            /** @default he-IL */
            defaultLocale: string;
        };
        UpdateOrganizationRequest: {
            displayName?: string;
            timeZone?: string;
            defaultLocale?: string;
        };
        Member: {
            /**
             * Format: uuid
             * @description The membership id.
             */
            id: string;
            /** Format: uuid */
            userAccountId: string;
            /** Format: email */
            email: string;
            displayName?: string | null;
            /**
             * @deprecated
             * @description Phase 1 field, kept one release. Read `roles` instead.
             */
            role: components["schemas"]["Role"];
            roles: components["schemas"]["RoleSummary"][];
            /** Format: uuid */
            personId?: string | null;
            status: components["schemas"]["MembershipStatus"];
            /** Format: date-time */
            joinedAt: string;
            version: string;
        };
        MemberPage: {
            items: components["schemas"]["Member"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        UpdateMemberRequest: {
            role?: components["schemas"]["InvitableRole"];
            /** @enum {string} */
            status?: "active" | "suspended";
        };
        CreateInvitationRequest: {
            /** Format: email */
            email: string;
            role: components["schemas"]["InvitableRole"];
        };
        Invitation: {
            /** Format: uuid */
            id: string;
            /** Format: email */
            email: string;
            role: components["schemas"]["InvitableRole"];
            status: components["schemas"]["InvitationStatus"];
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            createdAt: string;
            invitedBy?: {
                /** Format: uuid */
                membershipId: string;
                displayName?: string | null;
            };
        };
        CreatedInvitation: components["schemas"]["Invitation"] & {
            /**
             * Format: uri
             * @description Shown once, as `https://<app>/invite#<token>`. The token is in the fragment, which browsers never
             *     send to a server; the app reads it and sends it in the body of preview and accept.
             */
            link: string;
        };
        InvitationPage: {
            items: components["schemas"]["Invitation"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        TokenRequest: {
            token: string;
        };
        InvitationPreview: {
            organization: {
                /** Format: uuid */
                id: string;
                displayName: string;
            };
            role: components["schemas"]["InvitableRole"];
            invitedByDisplayName?: string | null;
            /** Format: date-time */
            expiresAt: string;
        };
        JoinCodeRequest: {
            code: string;
        };
        JoinPreview: {
            organization: {
                /** Format: uuid */
                id: string;
                displayName: string;
            };
        };
        JoinLink: {
            /**
             * Format: uri
             * @description `https://<client app>/join#<code>`. The code is in the fragment; the app sends it in the body of
             *     join preview and join.
             */
            link: string;
            /** Format: date-time */
            createdAt: string;
        };
        AuditEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            occurredAt: string;
            /** @enum {string} */
            actorType: "user" | "operator" | "system";
            actorDisplayName?: string | null;
            /** @example membership.role_changed */
            action: string;
            /** @example membership */
            targetType: string;
            /** Format: uuid */
            targetId?: string | null;
            data?: {
                [key: string]: unknown;
            };
        };
        AuditEventPage: {
            items: components["schemas"]["AuditEvent"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        PlatformOrganization: {
            /** Format: uuid */
            id: string;
            slug: string;
            displayName: string;
            status: components["schemas"]["OrganizationStatus"];
            /** Format: date-time */
            createdAt: string;
            owner: {
                /** Format: uuid */
                userAccountId: string;
                /** Format: email */
                email: string;
                displayName?: string | null;
            };
            memberCounts: {
                owner: number;
                admin: number;
                staff: number;
                client: number;
            };
        };
        PlatformOrganizationPage: {
            items: components["schemas"]["PlatformOrganization"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        ReasonRequest: {
            reason: string;
        };
        PlatformStats: {
            activeOrganizations: number;
            suspendedOrganizations: number;
            accounts: number;
            activeMemberships: number;
            /**
             * @description Active studios at which the owner is alerted to move to hourly backups (ADR-0021).
             * @example 10
             */
            hourlyBackupThreshold: number;
        };
        /**
         * @description A stable key from the permission catalog (docs/27 section 3.1). New keys can appear in later phases, so
         *     clients must ignore keys they do not know.
         * @example members.view
         * @example people.manage
         */
        PermissionKey: string;
        RoleSummary: {
            /** Format: uuid */
            id: string;
            /** @example admin */
            key: string;
            /** @example מנהל */
            displayName: string;
            isSystem: boolean;
        };
        RoleDetail: components["schemas"]["RoleSummary"] & {
            permissions: components["schemas"]["PermissionKey"][];
        };
        RoleList: {
            items: components["schemas"]["RoleDetail"][];
        };
        Permission: {
            key: components["schemas"]["PermissionKey"];
            description: string;
        };
        PermissionList: {
            items: components["schemas"]["Permission"][];
        };
        SetMemberRolesRequest: {
            roleIds: string[];
        };
        /** @enum {string} */
        OwnershipTransferStatus: "pending" | "accepted" | "declined" | "cancelled" | "expired";
        OwnershipTransfer: {
            /** Format: uuid */
            id: string;
            status: components["schemas"]["OwnershipTransferStatus"];
            from: components["schemas"]["MemberRef"];
            to: components["schemas"]["MemberRef"];
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description Shown on the membership of the owner who offered the studio and of the admin who can accept it. */
        PendingOwnershipTransfer: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            direction: "outgoing" | "incoming";
            /** Format: date-time */
            expiresAt: string;
        };
        MemberRef: {
            /** Format: uuid */
            membershipId: string;
            displayName?: string | null;
        };
        StartOwnershipTransferRequest: {
            /** Format: uuid */
            toMembershipId: string;
        };
        ForceOwnerTransferRequest: {
            /** Format: uuid */
            toMembershipId: string;
            reason: string;
            /** @description Support ticket reference. */
            ticket: string;
        };
        /** @enum {string} */
        PersonStatus: "active" | "archived" | "anonymized" | "merged";
        /**
         * @description `organization_created` is the owner who opened the studio.
         * @enum {string}
         */
        PersonSource: "organization_created" | "join_link" | "invitation" | "staff_created" | "import";
        Person: {
            /** Format: uuid */
            id: string;
            /** @example נועה לוי */
            displayName: string;
            givenName?: string | null;
            familyName?: string | null;
            /** Format: date */
            birthDate?: string | null;
            status: components["schemas"]["PersonStatus"];
            source: components["schemas"]["PersonSource"];
            hasLogin: boolean;
            /** Format: uuid */
            membershipId?: string | null;
            /** Format: email */
            primaryEmail?: string | null;
            /**
             * @description E.164
             * @example +972501234567
             */
            primaryPhone?: string | null;
            /** Format: uuid */
            mergedIntoId?: string | null;
            /** @description The person's tags, by name (docs/34 section 7). */
            tags?: components["schemas"]["PersonTag"][];
            /** Format: date-time */
            createdAt: string;
            /** @description Send back in `If-Match` when updating. */
            version: string;
        };
        PersonDetail: components["schemas"]["Person"] & {
            contactPoints: components["schemas"]["ContactPoint"][];
            /** @description The current state per purpose and channel (the latest row of each). */
            consents: components["schemas"]["Consent"][];
            relationships: components["schemas"]["Relationship"][];
        };
        PersonPage: {
            items: components["schemas"]["Person"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        /** @description At least one of `email` or `phone` is required (P-6). */
        CreatePersonRequest: {
            displayName: string;
            givenName?: string;
            familyName?: string;
            /** Format: date */
            birthDate?: string;
            /** Format: email */
            email?: string;
            /** @example 050-1234567 */
            phone?: string;
        };
        UpdatePersonRequest: {
            displayName?: string;
            givenName?: string | null;
            familyName?: string | null;
            /** Format: date */
            birthDate?: string | null;
            /** @enum {string} */
            status?: "active" | "archived";
        };
        UpdateMyProfileRequest: {
            displayName?: string;
            givenName?: string | null;
            familyName?: string | null;
            /** Format: date */
            birthDate?: string | null;
        };
        /** @enum {string} */
        ContactPointType: "email" | "phone";
        ContactPoint: {
            /** Format: uuid */
            id: string;
            type: components["schemas"]["ContactPointType"];
            /** @description Email in lowercase, phone in E.164. */
            value: string;
            isPrimary: boolean;
            /** @description The login's email; changes only with the account. */
            verified: boolean;
            version: string;
        };
        CreateContactPointRequest: {
            type: components["schemas"]["ContactPointType"];
            value: string;
            /** @default false */
            isPrimary: boolean;
        };
        UpdateContactPointRequest: {
            value?: string;
            /**
             * @description Makes this the primary of its type.
             * @constant
             */
            isPrimary?: true;
        };
        /** @enum {string} */
        ConsentPurpose: "marketing" | "reminders";
        /** @enum {string} */
        ConsentChannel: "email" | "push" | "whatsapp";
        Consent: {
            /** Format: uuid */
            id: string;
            purpose: components["schemas"]["ConsentPurpose"];
            channel: components["schemas"]["ConsentChannel"];
            /** @enum {string} */
            state: "granted" | "withdrawn";
            /** @enum {string} */
            method: "self" | "staff_on_behalf" | "import";
            /** @description The version of the consent text the person agreed to. */
            textVersion: string;
            recordedBy?: components["schemas"]["MemberRef"];
            /** Format: date-time */
            occurredAt: string;
        };
        ConsentList: {
            items: components["schemas"]["Consent"][];
        };
        RecordConsentRequest: {
            purpose: components["schemas"]["ConsentPurpose"];
            channel: components["schemas"]["ConsentChannel"];
            /** @enum {string} */
            state: "granted" | "withdrawn";
            /** @example marketing-he-2026-10 */
            textVersion: string;
        };
        /** @enum {string} */
        RelationshipType: "guardian_of" | "emergency_contact_for";
        Relationship: {
            /** Format: uuid */
            id: string;
            type: components["schemas"]["RelationshipType"];
            /** Format: uuid */
            fromPersonId: string;
            /** Format: uuid */
            toPersonId: string;
            /** @description The name of the person on the other side. */
            otherDisplayName: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description `{personId}` in the path is the `from` side: the guardian, or the emergency contact. */
        CreateRelationshipRequest: {
            type: components["schemas"]["RelationshipType"];
            /** Format: uuid */
            toPersonId: string;
        };
        InvitePersonRequest: {
            /**
             * Format: email
             * @description Where the person will sign in; added as a contact if new.
             */
            email: string;
        };
        PersonExport: {
            /** Format: date-time */
            exportedAt: string;
            organization?: {
                /** Format: uuid */
                id: string;
                displayName: string;
            };
            person: components["schemas"]["PersonDetail"];
            consentHistory: components["schemas"]["Consent"][];
            /** @description Every booking of this person, in class order (docs/29 section 7). */
            bookings: components["schemas"]["ExportBooking"][];
            /** @description Every pass granted to this person, in start order. No staff note. */
            passes: components["schemas"]["ExportPass"][];
            /** @description Current and replaced declarations, oldest first (docs/31 section 11). */
            healthDeclarations?: components["schemas"]["ExportHealthDeclaration"][];
            /** @description The person's buddies (docs/33 section 4), oldest link first. */
            buddies?: components["schemas"]["Buddy"][];
            /** @description True when answers and names are null; `healthAnswersWithheldReason` says why. */
            healthAnswersWithheld?: boolean;
            /** @description The names of the person's tags (docs/34 section 9). */
            tags?: string[];
            /** @description Staff notes on the person, oldest first, the author by role only (docs/34 section 9). */
            notes?: components["schemas"]["ExportNote"][];
            /**
             * @description `no_health_view` when the exporting member lacks `health.view`; `health_key_unavailable` when the health
             *     data key could not be read (docs/32 section 11, A-5): the rest of the export is complete. Null when the
             *     answers are included.
             * @enum {string|null}
             */
            healthAnswersWithheldReason?: "no_health_view" | "health_key_unavailable" | null;
        };
        /** @description docs/34 section 4. Cells are sent as the file has them, trimmed; the API validates and normalizes. */
        ImportPeopleRequest: {
            /** @description True checks every row and writes nothing. */
            dryRun: boolean;
            /**
             * Format: uuid
             * @description Every person the import creates gets this tag (I-8). It must be one of the studio's tags (404 `tag.not_found`).
             */
            tagId?: string | null;
            rows: components["schemas"]["ImportRow"][];
        };
        ImportRow: {
            /** @description The row's line in the file, echoed in the result. */
            line: number;
            /** @description Empty means given and family names joined. */
            displayName?: string | null;
            givenName?: string | null;
            familyName?: string | null;
            /** @description Israeli local or with a country code, as `createPerson` reads it. */
            phone?: string | null;
            email?: string | null;
            /** @description `dd/mm/yyyy` (or `d/m/yyyy`), `d.m.yyyy` or `yyyy-mm-dd`, as the file has it. */
            birthDate?: string | null;
        };
        ImportPeopleResult: {
            dryRun: boolean;
            /**
             * Format: uuid
             * @description Null on a dry run; the id in the `people.imported` audit entry.
             */
            importId?: string | null;
            totals: components["schemas"]["ImportTotals"];
            /** @description One outcome per row, in the order sent. */
            rows: components["schemas"]["ImportRowResult"][];
        };
        ImportTotals: {
            rows: number;
            /** @description Rows that would be created (dry run) or were created. */
            valid: number;
            /** @description Zero on a dry run. */
            created: number;
            exists: number;
            duplicateInFile: number;
            invalid: number;
        };
        ImportRowResult: {
            line: number;
            /** @enum {string} */
            outcome: "valid" | "created" | "exists" | "duplicate_in_file" | "invalid";
            /**
             * Format: uuid
             * @description The created person (`created`) or the one already in the studio (`exists`).
             */
            personId?: string | null;
            /** @description `duplicate_in_file`: the earlier line. */
            duplicateOfLine?: number | null;
            /** @description `valid` or `created`, but another person has the same name and birth date: flagged for the duplicates page, not merged. */
            possibleDuplicate?: boolean;
            /**
             * @description `invalid`: the field at fault (`contact` when there is neither phone nor email).
             * @enum {string|null}
             */
            field?: "display_name" | "phone" | "email" | "birth_date" | "contact" | null;
            /** @description `invalid`: `required`, `too_long`, `phone.invalid`, `email.invalid`, `birth_date.invalid` or `contact.required`. */
            code?: string | null;
        };
        Tag: {
            /** Format: uuid */
            id: string;
            /** @example ייבוא 17.10 */
            name: string;
            /** @description One of six tones the design system draws. */
            color: number;
            /** @description People who have the tag now. */
            peopleCount: number;
            /** Format: date-time */
            createdAt: string;
            version: string;
        };
        TagList: {
            items: components["schemas"]["Tag"][];
        };
        CreateTagRequest: {
            name: string;
            color: number;
        };
        UpdateTagRequest: {
            name?: string;
            color?: number;
        };
        PersonTag: {
            /** Format: uuid */
            id: string;
            name: string;
            color: number;
        };
        PersonTagList: {
            items: components["schemas"]["PersonTag"][];
        };
        PersonNote: {
            /** Format: uuid */
            id: string;
            body: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: uuid
             * @description Null once the author's membership is gone.
             */
            authorMembershipId?: string | null;
            /** @description The author's display name in this studio; null once their membership is gone. */
            authorName?: string | null;
            /** @description The author's system role when they wrote it: owner, admin or staff (a custom role shows as staff). */
            authorRole: string;
            /** @description The caller wrote it. */
            mine: boolean;
        };
        PersonNotePage: {
            items: components["schemas"]["PersonNote"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        CreatePersonNoteRequest: {
            body: string;
        };
        ExportNote: {
            body: string;
            /** Format: date-time */
            createdAt: string;
            /** @description The author by role, never by name (docs/34 section 9). */
            authorRole: string;
        };
        ExportBooking: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            sessionId: string;
            /** @example פילאטיס מכשירים */
            className: string;
            /** Format: date-time */
            startsAt: string;
            status: components["schemas"]["BookingStatus"];
            lateCancel: boolean;
            /** @enum {string|null} */
            cancelReason?: "self" | "staff" | "session_cancelled" | "no_valid_pass" | "moved" | null;
            /** Format: date-time */
            createdAt: string;
        };
        ExportPass: {
            /** Format: uuid */
            id: string;
            /** @example כרטיסיית 10 */
            productName: string;
            kind: components["schemas"]["PassKind"];
            /** Format: date */
            startsOn: string;
            /** Format: date */
            endsOn: string;
            entries?: number | null;
            entriesUsed: number;
            /** @enum {string} */
            status: "active" | "voided";
            /** Format: date-time */
            createdAt: string;
        };
        DuplicateCandidate: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            reason: "email" | "phone" | "name_birth_date";
            /** @enum {string} */
            status: "open" | "merged" | "not_duplicate";
            personA: components["schemas"]["Person"];
            personB: components["schemas"]["Person"];
            /** Format: date-time */
            createdAt: string;
            version: string;
        };
        DuplicateCandidatePage: {
            items: components["schemas"]["DuplicateCandidate"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        ResolveDuplicateRequest: {
            /** @enum {string} */
            resolution: "merge" | "not_duplicate";
            /**
             * Format: uuid
             * @description Required when `resolution` is `merge`; one of the pair.
             */
            survivorPersonId?: string;
        };
        /**
         * @description A class color from the design system.
         * @enum {string}
         */
        ClassColor: "sage" | "rose" | "taupe" | "amber" | "mauve" | "blue";
        /**
         * @description A wall-clock time in the studio's time zone, `HH:MM`.
         * @example 17:30
         */
        LocalTime: string;
        Room: {
            /** Format: uuid */
            id: string;
            /** @example חדר המכשירים */
            name: string;
            defaultCapacity: number;
            /** @enum {string} */
            status: "active" | "archived";
            version: string;
        };
        RoomList: {
            items: components["schemas"]["Room"][];
        };
        CreateRoomRequest: {
            name: string;
            defaultCapacity: number;
        };
        UpdateRoomRequest: {
            name?: string;
            defaultCapacity?: number;
            /** @enum {string} */
            status?: "active" | "archived";
        };
        ClassType: {
            /** Format: uuid */
            id: string;
            /** @example פילאטיס מכשירים */
            name: string;
            /**
             * @description Groups class types for filters and for passes limited to one category.
             * @example pilates
             */
            category: string;
            color: components["schemas"]["ClassColor"];
            defaultMinutes: number;
            description?: string | null;
            /** @enum {string} */
            status: "active" | "archived";
            version: string;
        };
        ClassTypeList: {
            items: components["schemas"]["ClassType"][];
        };
        CreateClassTypeRequest: {
            name: string;
            category: string;
            color: components["schemas"]["ClassColor"];
            defaultMinutes: number;
            description?: string;
        };
        UpdateClassTypeRequest: {
            name?: string;
            category?: string;
            color?: components["schemas"]["ClassColor"];
            defaultMinutes?: number;
            description?: string | null;
            /** @enum {string} */
            status?: "active" | "archived";
        };
        /** @description A weekly class. `weekday` 0 is Sunday; times are in the studio's time zone. */
        ScheduleTemplate: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            classTypeId: string;
            weekday: number;
            localStart: components["schemas"]["LocalTime"];
            minutes: number;
            /** Format: uuid */
            instructorMembershipId?: string | null;
            /** Format: uuid */
            roomId?: string | null;
            capacity: number;
            /** Format: date */
            validFrom: string;
            /** Format: date */
            validUntil?: string | null;
            version: string;
            /** @description The class type as the console shows it in the weekly grid (same shape as `Session.classType`). */
            classType: {
                /** Format: uuid */
                id: string;
                name: string;
                category: string;
                color: components["schemas"]["ClassColor"];
                description?: string | null;
            };
            instructor?: components["schemas"]["InstructorRef"] | null;
            room?: {
                /** Format: uuid */
                id: string;
                name: string;
            } | null;
        };
        ScheduleTemplateList: {
            items: components["schemas"]["ScheduleTemplate"][];
        };
        CreateScheduleTemplateRequest: {
            /** Format: uuid */
            classTypeId: string;
            weekday: number;
            localStart: components["schemas"]["LocalTime"];
            /** @description Defaults to the class type's `defaultMinutes`. */
            minutes?: number;
            /** Format: uuid */
            instructorMembershipId?: string;
            /** Format: uuid */
            roomId?: string;
            capacity: number;
            /**
             * Format: date
             * @description Defaults to today.
             */
            validFrom?: string;
            /** Format: date */
            validUntil?: string;
        };
        UpdateScheduleTemplateRequest: {
            weekday?: number;
            localStart?: components["schemas"]["LocalTime"];
            minutes?: number;
            /** Format: uuid */
            instructorMembershipId?: string | null;
            /** Format: uuid */
            roomId?: string | null;
            capacity?: number;
            /**
             * Format: date
             * @description Ending a weekly class removes its future sessions that have no live bookings.
             */
            validUntil?: string | null;
        };
        ScheduleTemplateChange: {
            template: components["schemas"]["ScheduleTemplate"];
            /** @description Future sessions that kept their old values because they have bookings; edit them one by one. */
            untouchedSessions: components["schemas"]["Session"][];
        };
        /** @enum {string} */
        SessionStatus: "scheduled" | "cancelled";
        InstructorRef: {
            /** Format: uuid */
            membershipId: string;
            /** @example דנה אלון */
            displayName: string;
        };
        /** @description The caller's own place in a session. */
        MyBookingState: {
            /** Format: uuid */
            bookingId: string;
            status: components["schemas"]["BookingStatus"];
            /** @description The caller's place in line (1 = next), counting only people still waiting. */
            waitlistPosition?: number | null;
            /** Format: date-time */
            freeCancelUntil?: string | null;
        };
        Session: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            templateId?: string | null;
            /** Format: date */
            localDate: string;
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            endsAt: string;
            classType: {
                /** Format: uuid */
                id: string;
                name: string;
                category: string;
                color: components["schemas"]["ClassColor"];
                /** @description About the class (AppClass). */
                description?: string | null;
            };
            instructor?: components["schemas"]["InstructorRef"] | null;
            room?: {
                /** Format: uuid */
                id: string;
                name: string;
            } | null;
            capacity: number;
            bookedCount: number;
            waitlistCount: number;
            status: components["schemas"]["SessionStatus"];
            /** @description The caller's booking or waitlist place; null when none. */
            myBooking?: components["schemas"]["MyBookingState"] | null;
            /** @description The pass a booking by the caller would use now (docs/29 section 5.3); null when none is valid. */
            passPreview?: components["schemas"]["PassSummary"] | null;
            /**
             * Format: date
             * @description When no pass is valid because the caller's membership is frozen on this class's day (docs/29 section
             *     16.4): the last frozen day, so the booking sheet can say so before the 409. Null otherwise.
             */
            frozenUntil?: string | null;
            version: string;
        };
        SessionList: {
            items: components["schemas"]["Session"][];
        };
        CreateSessionRequest: {
            /** Format: uuid */
            classTypeId: string;
            /** Format: date */
            localDate: string;
            localStart: components["schemas"]["LocalTime"];
            minutes?: number;
            /** Format: uuid */
            instructorMembershipId?: string;
            /** Format: uuid */
            roomId?: string;
            capacity: number;
        };
        UpdateSessionRequest: {
            /** Format: uuid */
            instructorMembershipId?: string | null;
            /** Format: uuid */
            roomId?: string | null;
            capacity?: number;
        };
        /** @enum {string} */
        BookingStatus: "booked" | "waitlisted" | "cancelled" | "attended" | "no_show" | "removed" | "expired";
        PersonRef: {
            /** Format: uuid */
            id: string;
            displayName: string;
        };
        Booking: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            sessionId: string;
            person: components["schemas"]["PersonRef"];
            status: components["schemas"]["BookingStatus"];
            waitlistPosition?: number | null;
            lateCancel: boolean;
            /** @enum {string|null} */
            cancelReason?: "self" | "staff" | "session_cancelled" | "no_valid_pass" | "moved" | null;
            /**
             * @description For a cancelled booking, whether it held a place or a waitlist place; null otherwise.
             * @enum {string|null}
             */
            cancelledFrom?: "booked" | "waitlisted" | null;
            /**
             * @description The pass this booking used, with its entries left now; still set after a cancellation (the entry may
             *     have returned). Null while waiting, and for a waitlist place that never got a seat.
             */
            pass?: components["schemas"]["PassSummary"] | null;
            /** Format: date-time */
            createdAt: string;
            version: string;
            /** @description The spot this place holds in a room with spot selection (docs/33 section 3); null otherwise. */
            spot?: components["schemas"]["SpotRef"] | null;
        };
        CreateBookingRequest: {
            /**
             * Format: uuid
             * @description Book someone else (`bookings.manage`). Omit to book yourself.
             */
            personId?: string;
            /**
             * Format: uuid
             * @description The spot to take in a room with spot selection. Omit to get the usual spot when free, else the first
             *     free one. 400 `booking.spot_not_offered` in a room without spots; 409 `booking.spot_unavailable` when
             *     it is taken. Ignored when the class is full and the booking joins the waitlist.
             */
            spotId?: string;
        };
        SpotRef: {
            /** Format: uuid */
            id: string;
            /** @example 6 */
            label: string;
        };
        /** @enum {string} */
        SpotKind: "reformer" | "mat" | "bike" | "tower" | "chair" | "place";
        RoomSpot: {
            /** Format: uuid */
            id: string;
            label: string;
            row: number;
            col: number;
            kind: components["schemas"]["SpotKind"];
            /** @enum {string} */
            status: "active" | "maintenance";
        };
        RoomLayout: {
            /** Format: uuid */
            roomId: string;
            /** @description Members pick a spot when they book. */
            spotSelection: boolean;
            rows?: number | null;
            cols?: number | null;
            /**
             * @description The wall with the window, as the room is drawn (start is the right side in Hebrew).
             * @enum {string|null}
             */
            windowSide?: "start" | "end" | "back" | null;
            /** @description A mirror wall at the front, where the instructor stands. */
            mirrorFront: boolean;
            spots: components["schemas"]["RoomSpot"][];
            version: string;
        };
        RoomLayoutRequest: {
            spotSelection?: boolean;
            rows?: number | null;
            cols?: number | null;
            /** @enum {string|null} */
            windowSide?: "start" | "end" | "back" | null;
            mirrorFront?: boolean;
            spots: {
                /**
                 * Format: uuid
                 * @description Keep this existing spot. Omit for a new spot.
                 */
                id?: string;
                label: string;
                row: number;
                col: number;
                kind?: components["schemas"]["SpotKind"];
                /**
                 * @default active
                 * @enum {string}
                 */
                status: "active" | "maintenance";
            }[];
        };
        SessionSpot: {
            /** Format: uuid */
            id: string;
            label: string;
            row: number;
            col: number;
            kind: components["schemas"]["SpotKind"];
            /**
             * @description `buddy`: a buddy of the caller holds it (D18); `person` then names them, for members too.
             * @enum {string}
             */
            state: "free" | "taken" | "mine" | "buddy" | "maintenance";
            /**
             * Format: uuid
             * @description The caller's own booking on it, or any booking for staff.
             */
            bookingId?: string | null;
            /** @description Who holds it; staff and the instructor, and a member for a buddy's spot. */
            person?: components["schemas"]["PersonRef"] | null;
            /**
             * @description The holder's booking status; staff and the instructor only.
             * @enum {string|null}
             */
            attendance?: "booked" | "attended" | "no_show" | null;
            /**
             * @description The holder's health declaration status, never answers; staff and the instructor only.
             * @enum {string|null}
             */
            healthStatus?: "signed" | "missing" | "expired" | "needs_medical_approval" | null;
        };
        SessionSpots: {
            /** Format: uuid */
            sessionId: string;
            /** Format: uuid */
            roomId?: string | null;
            spotSelection: boolean;
            rows?: number | null;
            cols?: number | null;
            /** @enum {string|null} */
            windowSide?: "start" | "end" | "back" | null;
            mirrorFront: boolean;
            /** Format: uuid */
            mySpotId?: string | null;
            /** Format: uuid */
            usualSpotId?: string | null;
            spots: components["schemas"]["SessionSpot"][];
        };
        Buddy: {
            /** Format: uuid */
            personId: string;
            displayName: string;
            /** Format: date-time */
            since: string;
        };
        BuddyList: {
            items: components["schemas"]["Buddy"][];
        };
        BuddyCode: {
            /** @example K7QM-X3RT */
            code: string;
            /** Format: date-time */
            expiresAt: string;
        };
        LinkBuddyRequest: {
            /** @description The 8 letters and digits; spaces, dashes and case are ignored. */
            code: string;
        };
        ChangeSpotRequest: {
            /** Format: uuid */
            spotId: string;
        };
        UsualSpotRequest: {
            /**
             * Format: uuid
             * @description Null clears the usual spot.
             */
            spotId: string | null;
        };
        MoveBookingRequest: {
            /**
             * Format: uuid
             * @description The class the place moves to.
             */
            sessionId: string;
        };
        SendSessionMessageRequest: {
            /**
             * @example החדר הוחלף לאולם הגדול
             * @example להביא מגבת
             */
            text: string;
        };
        SessionMessage: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            sessionId: string;
            /** @description How many booked and waiting people got it. */
            recipients: number;
            /** Format: date-time */
            createdAt: string;
        };
        CancelBookingRequest: {
            /** @description Staff only (`bookings.manage`), return the entry on a late cancellation. */
            returnEntry?: boolean;
        };
        AttendanceRequest: {
            /** @enum {string} */
            state: "attended" | "no_show";
        };
        RosterEntry: {
            /** Format: uuid */
            bookingId: string;
            person: components["schemas"]["PersonRef"];
            status: components["schemas"]["BookingStatus"];
            waitlistPosition?: number | null;
            /** @example כרטיסיית 10 */
            passName?: string | null;
            /** @description Entries left on the punch card this place holds, after it; null for a membership or when no pass is held (a waitlist place). */
            entriesLeft?: number | null;
            /** @description The person's declaration status (docs/31 section 5); null when the caller lacks `people.view`. */
            healthStatus?: components["schemas"]["HealthDeclarationStatus"] | null;
            /** Format: date-time */
            bookedAt: string;
        };
        Roster: {
            session: components["schemas"]["Session"];
            /** @description Booked, attended and no-show places, in booking order. */
            booked: components["schemas"]["RosterEntry"][];
            /** @description In line order. */
            waitlisted: components["schemas"]["RosterEntry"][];
        };
        MyBooking: components["schemas"]["Booking"] & {
            session: components["schemas"]["Session"];
        };
        MyBookingPage: {
            items: components["schemas"]["MyBooking"][];
            /** Format: uuid */
            nextBefore?: string | null;
        };
        /** @enum {string} */
        PassKind: "punch_card" | "membership";
        PassProduct: {
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["PassKind"];
            /** @example כרטיסיית 10 כניסות */
            name: string;
            /** @description Punch cards only. */
            entries?: number | null;
            validDays: number;
            /** @description Memberships only; null means unlimited. */
            weeklyCap?: number | null;
            /** @description Only class types of this category; null means all. */
            classCategory?: string | null;
            /** @description Shown to staff only; nothing charges it yet. */
            priceAgorot?: number | null;
            /** @enum {string} */
            status: "active" | "archived";
            version: string;
        };
        PassProductList: {
            items: components["schemas"]["PassProduct"][];
        };
        CreatePassProductRequest: {
            kind: components["schemas"]["PassKind"];
            name: string;
            /** @description Required for a punch card. */
            entries?: number;
            validDays: number;
            /** @description Memberships only. */
            weeklyCap?: number;
            classCategory?: string;
            priceAgorot?: number;
        };
        PassSummary: {
            /** Format: uuid */
            id: string;
            name: string;
            kind: components["schemas"]["PassKind"];
            /** Format: date */
            endsOn: string;
            /** @description Punch cards only. */
            entriesLeft?: number | null;
        };
        Pass: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            personId: string;
            product: {
                /** Format: uuid */
                id: string;
                name: string;
                kind: components["schemas"]["PassKind"];
                weeklyCap?: number | null;
                classCategory?: string | null;
            };
            /** Format: date */
            startsOn: string;
            /** Format: date */
            endsOn: string;
            entries?: number | null;
            entriesUsed: number;
            entriesLeft?: number | null;
            note?: string | null;
            /**
             * @description `expired` is computed from `endsOn`.
             * @enum {string}
             */
            status: "active" | "voided" | "expired";
            /** Format: date-time */
            createdAt: string;
            version: string;
            /** @description Frozen periods of a membership, in start order (docs/29 section 16.4); empty for a punch card. Always sent; optional here so sample data without it still types. */
            freezes?: components["schemas"]["PassFreeze"][];
        };
        PassFreeze: {
            /** Format: uuid */
            id: string;
            /** Format: date */
            startsOn: string;
            /** Format: date */
            endsOn: string;
        };
        FreezePassRequest: {
            /**
             * Format: date
             * @description Studio date, today or later.
             */
            startsOn: string;
            /**
             * Format: date
             * @description Inclusive; at most 90 days after startsOn.
             */
            endsOn: string;
        };
        PassList: {
            items: components["schemas"]["Pass"][];
        };
        GrantPassRequest: {
            /** Format: uuid */
            productId: string;
            /**
             * Format: date
             * @description Defaults to today in the studio's time zone.
             */
            startsOn?: string;
            /** @example שולם במזומן */
            note?: string;
        };
        BookingPolicy: {
            freeCancelHours: number;
            waitlistCutoffHours: number;
            bookingHorizonDays: number;
            waitlistEnabled: boolean;
            /** @description docs/31 section 10. When true, a member's own booking or waitlist place needs a `signed` declaration, else 409 `health.declaration_required`; staff booking for someone else is allowed and audited. Always sent since H2; optional in the schema only so older app fixtures keep compiling. */
            requireHealthDeclaration?: boolean;
            version: string;
        };
        BookingPolicyInput: {
            freeCancelHours: number;
            waitlistCutoffHours: number;
            bookingHorizonDays: number;
            waitlistEnabled: boolean;
            /** @description docs/31 section 10. Left out keeps the current value; off by default. */
            requireHealthDeclaration?: boolean;
        };
        InboxItem: {
            /** Format: uuid */
            id: string;
            /**
             * @description Clients must ignore kinds they do not know.
             * @example booking.promoted
             * @example booking.promotion_failed
             * @example booking.moved
             * @example session.message
             * @example session.cancelled
             * @example waitlist.expired
             * @example pass.frozen
             * @example reminder.class_tomorrow
             * @example reminder.class_soon
             * @example reminder.pass_ending
             * @example reminder.entries_low
             */
            kind: string;
            /** @description Ids only, and only the ones the kind carries; a key that does not apply is left out. Class kinds carry `sessionId` (and `bookingId` for a place); `pass.frozen`, `reminder.pass_ending` and `reminder.entries_low` carry `passId`. */
            data: {
                /** Format: uuid */
                sessionId?: string;
                /** Format: uuid */
                bookingId?: string;
                /** Format: uuid */
                passId?: string;
            };
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            readAt?: string | null;
            /** @description For `session.message`, the staff message (docs/29 section 16.2); for `studio.announcement` (docs/30 step 7), the announcement's Markdown-light body. Null for every other kind. */
            text?: string | null;
            /** @description The subject rendered from the studio's template (or the default) when the item was written (docs/30 step 7); the announcement's subject for `studio.announcement`. Absent or null on older items and on `session.message`: show the app's own text for the kind. */
            title?: string | null;
            /** @description The template's Markdown-light body with the variables filled when the item was written. A backslash escapes `\`, `*`, `[`, `]`, `(` and `)` that came from a value, so a name never bolds or links. Links are app paths (`/classes/{id}`, `/profile/notifications`). Absent or null on older items and on `session.message` / `studio.announcement` (see `text`). */
            body?: string | null;
            /** @description The class the notice is about, so a list needs no extra request; null when it has none. */
            session?: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                startsAt: string;
                classTypeName: string;
            } | null;
        };
        InboxPage: {
            items: components["schemas"]["InboxItem"][];
            unreadCount: number;
            /** Format: uuid */
            nextBefore?: string | null;
        };
        /** @description A window that may cross midnight (22:00 to 08:00). Reminders and studio messages wait until it ends; a notice about the member's own booking for a class that starts inside the window still goes out (D-4). */
        QuietHours: {
            startsLocal: components["schemas"]["LocalTime"];
            endsLocal: components["schemas"]["LocalTime"];
        };
        /** @description Email joins as an optional field once docs/30 D-1 is decided; clients must ignore unknown channels. */
        NotificationChannels: {
            /** @description Always true; the in-app inbox cannot be switched off. */
            inbox: boolean;
            push: boolean;
        };
        NotificationGroupPreference: {
            /**
             * @description `bookings` are service notices about the member's own bookings (docs/30 section 5).
             * @enum {string}
             */
            group: "bookings" | "reminders" | "studio";
            channels: components["schemas"]["NotificationChannels"];
        };
        /** @description The member's own switch per reminder; a reminder the studio switched off never fires. */
        ReminderSwitches: {
            classTomorrow: boolean;
            classSoon: boolean;
            passEnding: boolean;
            entriesLow: boolean;
        };
        NotificationPreferences: {
            /** @description One row per group, always all three, in the order bookings, reminders, studio. */
            groups: components["schemas"]["NotificationGroupPreference"][];
            reminders: components["schemas"]["ReminderSwitches"];
            /** @description The member's own window; null means the studio's window applies. */
            quietHours: components["schemas"]["QuietHours"] | null;
            studioQuietHours: components["schemas"]["QuietHours"];
            /** @description Which reminders the studio offers at all, so the settings page can hide the others. */
            studioReminders: components["schemas"]["ReminderSwitches"];
            /** @description The studio's IANA time zone, e.g. Asia/Jerusalem. */
            timeZone: string;
            version: string;
        };
        NotificationPreferencesInput: {
            /** @description Groups left out keep their current channels. */
            groups: components["schemas"]["NotificationGroupPreference"][];
            reminders: components["schemas"]["ReminderSwitches"];
            quietHours: components["schemas"]["QuietHours"] | null;
        };
        /** @description The endpoint and keys are never returned. */
        PushSubscription: {
            /** Format: uuid */
            id: string;
            /** @description What the settings page lists, e.g. "Chrome, Android". */
            deviceLabel: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            lastSuccessAt?: string | null;
        };
        PushSubscriptionList: {
            items: components["schemas"]["PushSubscription"][];
        };
        CreatePushSubscriptionRequest: {
            /** Format: uri */
            endpoint: string;
            keys: {
                /** @description Base64url, as the browser gives it. */
                p256dh: string;
                /** @description Base64url, as the browser gives it. */
                auth: string;
            };
            deviceLabel: string;
        };
        VapidPublicKey: {
            /** @description Base64url, uncompressed P-256 point (the `applicationServerKey`). */
            publicKey: string;
        };
        ReminderTiming: {
            /** @description The evening before the class (D-5 default 18:00). */
            classTomorrow: {
                enabled: boolean;
                sendAtLocal: components["schemas"]["LocalTime"];
            };
            /** @description Before the class starts (D-5 default 2 hours). */
            classSoon: {
                enabled: boolean;
                hoursBefore: number;
            };
            /** @description Before a pass's last day (D-5 default 7 days). */
            passEnding: {
                enabled: boolean;
                daysBefore: number;
            };
            /** @description When a punch card reaches this many entries left (D-5 default 1). */
            entriesLow: {
                enabled: boolean;
                entriesLeft: number;
            };
        };
        NotificationSettings: {
            quietHours: components["schemas"]["QuietHours"];
            reminders: components["schemas"]["ReminderTiming"];
            timeZone: string;
            version: string;
        };
        NotificationSettingsInput: {
            quietHours: components["schemas"]["QuietHours"];
            reminders: components["schemas"]["ReminderTiming"];
        };
        /** @enum {string} */
        NotificationGroup: "bookings" | "reminders" | "studio";
        NotificationTemplateList: {
            items: {
                /** @example booking.promoted */
                kind: string;
                group: components["schemas"]["NotificationGroup"];
                /** @description The channels (in the default locale) where the studio has its own words. */
                customized: ("inbox" | "push")[];
                /** Format: date-time */
                updatedAt: string | null;
            }[];
        };
        TemplateText: {
            /** @description The inbox subject; the push title. */
            subject: string;
            /** @description Markdown-light (paragraphs split by a blank line, `**bold**`, `[text](link)`) with variables written `{{person.firstName}}`; `{{link.session}}` and `{{link.preferences}}` are app paths. Push shows the first paragraph without markup, cut at 120 characters. */
            body: string;
            /** @enum {string} */
            source: "default" | "studio";
            /** @description The studio's active version; null on the default. */
            studioVersion: number | null;
            /** @description Rendered with `sampleValues`: `subject` is plain text; `body` is the Markdown-light text with the variables filled (inbox) or the plain push body of at most 120 characters (push). */
            preview: {
                subject: string;
                body: string;
            };
        };
        NotificationTemplate: {
            kind: string;
            group: components["schemas"]["NotificationGroup"];
            /** @enum {string} */
            locale: "he" | "en";
            /** @description The closed list this kind may use (docs/30 section 6); anything else is refused on save. */
            variables: string[];
            /** @description The demo studio's value per variable, for a live preview while editing. */
            sampleValues: {
                [key: string]: string;
            };
            channels: {
                inbox: components["schemas"]["TemplateText"];
                push: components["schemas"]["TemplateText"];
            };
            /** @description Send back as If-Match. */
            version: string;
        };
        TemplateTextInput: {
            subject: string;
            body: string;
        };
        NotificationTemplateInput: {
            /** @enum {string} */
            locale: "he" | "en";
            /** @description The studio's inbox words, or null for the platform default. */
            inbox: components["schemas"]["TemplateTextInput"] | null;
            /** @description The studio's push words, or null for the platform default. */
            push: components["schemas"]["TemplateTextInput"] | null;
        };
        AnnouncementAllowance: {
            /** @description Active members right now. */
            recipients: number;
            /** @example 500 */
            maxRecipients: number;
            /** @description In the studio's day (its time zone). */
            sentToday: number;
            /** @example 3 */
            dailyLimit: number;
        };
        AnnouncementInput: {
            subject: string;
            /** @description Markdown-light, no variables. */
            body: string;
        };
        Announcement: {
            /** Format: uuid */
            id: string;
            recipients: number;
            /** Format: date-time */
            sentAt: string;
            sentToday: number;
            dailyLimit: number;
        };
        Delivery: {
            /** Format: uuid */
            id: string;
            kind: string;
            /** @enum {string} */
            channel: "inbox" | "email" | "push";
            /** @enum {string} */
            status: "queued" | "sending" | "accepted" | "delivered" | "failed" | "retry_scheduled" | "dead" | "skipped";
            /** @description The skip reason (`preference_off`, `quiet_hours`, `no_subscription`, `undeliverable`, `no_consent`, `channel_unavailable`) or the last error code (`http_403`, ...); null when there is none. */
            reason: string | null;
            attempts: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        DeliveryList: {
            items: components["schemas"]["Delivery"][];
        };
        /** @enum {string} */
        SubscriptionState: "trialing" | "active" | "past_due" | "grace" | "restricted" | "canceled";
        /**
         * @description Entitlement keys and values from the plan and overrides, e.g. `rooms.max`. Ignore unknown keys.
         * @example {
         *       "rooms.max": 20,
         *       "class_types.max": 50,
         *       "staff.max": 10
         *     }
         */
        Entitlements: {
            [key: string]: unknown;
        };
        PlanVersion: {
            /** Format: uuid */
            id: string;
            /** @example pilot */
            planKey: string;
            displayName: string;
            /** @description Agorot, VAT included (B-7). */
            priceMinor: number;
            /** @example ILS */
            currency: string;
            /** @enum {string} */
            interval: "month" | "year";
            entitlements: components["schemas"]["Entitlements"];
        };
        PlanList: {
            items: components["schemas"]["PlanVersion"][];
        };
        BillingOverview: {
            plan: components["schemas"]["PlanVersion"];
            state: components["schemas"]["SubscriptionState"];
            /** @example manual */
            provider: string;
            /** Format: date-time */
            trialEndsAt?: string | null;
            /** Format: date-time */
            currentPeriodEnd?: string | null;
            /** Format: date-time */
            graceEndsAt?: string | null;
            /** Format: email */
            billingEmail?: string | null;
            legalName?: string | null;
            businessId?: string | null;
            cardLast4?: string | null;
            entitlements: components["schemas"]["Entitlements"];
            version: string;
        };
        UpdateBillingAccountRequest: {
            /** Format: email */
            billingEmail?: string;
            legalName?: string;
            /** @description Israeli company or licensed-dealer number. */
            businessId?: string;
        };
        SetPlanRequest: {
            /** Format: uuid */
            planVersionId: string;
            reason: string;
        };
        RecordPaymentRequest: {
            amountMinor: number;
            /** @enum {string} */
            method: "transfer" | "cash" | "check" | "other";
            reference?: string;
            reason: string;
        };
        SetEntitlementOverrideRequest: {
            /** @description A number, boolean or string, as the key defines. */
            value: unknown;
            reason: string;
            /** Format: date-time */
            endsAt?: string | null;
        };
        /**
         * @description docs/31 section 4. `signed` includes a "yes" with a recorded medical approval.
         * @enum {string}
         */
        HealthDeclarationStatus: "missing" | "signed" | "needs_medical_approval" | "expired";
        HealthFormQuestion: {
            /** @example q1 */
            id: string;
            /** @description The question in Hebrew; the platform's draft wording until the lawyer check (P-2). */
            text: string;
        };
        HealthForm: {
            version: number;
            /** @example he-IL */
            locale: string;
            questions: components["schemas"]["HealthFormQuestion"][];
        };
        /** @description Status and dates only; never the answers or the names. */
        HealthDeclarationStatusView: {
            status: components["schemas"]["HealthDeclarationStatus"];
            /**
             * Format: uuid
             * @description Null when the status is `missing`.
             */
            declarationId?: string | null;
            formVersion?: number | null;
            /** @enum {string|null} */
            signerRole?: "self" | "guardian" | null;
            /** Format: date-time */
            signedAt?: string | null;
            /**
             * Format: date-time
             * @description 12 months after `signedAt`.
             */
            expiresAt?: string | null;
            /** Format: date */
            medicalApprovalOn?: string | null;
        };
        MyHealthDeclaration: {
            declaration: components["schemas"]["HealthDeclarationStatusView"];
            /** @description The current form, to sign or renew. */
            form: components["schemas"]["HealthForm"];
            /** @description The studio's `requireHealthDeclaration`; when true, booking needs `signed`. */
            required: boolean;
        };
        HealthAnswer: {
            questionId: string;
            /** @description true is "yes". */
            answer: boolean;
        };
        SignHealthDeclarationRequest: {
            formVersion: number;
            /** @description One answer for every question of that version, no more. */
            answers: components["schemas"]["HealthAnswer"][];
            /** @description The member's full name, as typed. */
            signedName: string;
            /** @enum {string} */
            signerRole: "self" | "guardian";
            /** @description The guardian who signs; required when `signerRole` is `guardian`. */
            guardianName?: string | null;
            /**
             * @description The confirmation checkbox.
             * @constant
             */
            confirmed: true;
        };
        HealthDeclarationAnswers: {
            /** Format: uuid */
            declarationId: string;
            status: components["schemas"]["HealthDeclarationStatus"];
            /** @description The version this declaration answered, which may be older than the current one. */
            form: components["schemas"]["HealthForm"];
            answers: components["schemas"]["HealthAnswer"][];
            signedName: string;
            /** @enum {string} */
            signerRole: "self" | "guardian";
            guardianName?: string | null;
            /** Format: date-time */
            signedAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: date */
            medicalApprovalOn?: string | null;
        };
        MedicalApprovalRequest: {
            /**
             * Format: date
             * @description Not in the future and not before the declaration was signed.
             */
            approvedOn: string;
        };
        /** @description Answers and names only when the exporting member holds `health.view`; each such export is audited. */
        ExportHealthDeclaration: {
            /** Format: uuid */
            declarationId: string;
            formVersion: number;
            status: components["schemas"]["HealthDeclarationStatus"];
            /** @enum {string} */
            signerRole: "self" | "guardian";
            /** Format: date-time */
            signedAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            supersededAt?: string | null;
            /** Format: date */
            medicalApprovalOn?: string | null;
            answers?: components["schemas"]["HealthAnswer"][] | null;
            signedName?: string | null;
            guardianName?: string | null;
        };
        MyProgress: {
            /**
             * @description This month in the studio's time zone.
             * @example 2026-10
             */
            month: string;
            /** @example Asia/Jerusalem */
            timeZone: string;
            /** @description Attended classes that start this month. */
            visitsThisMonth: number;
            /** @description Null until the member sets one; the app hides the goal ring. */
            monthlyGoal: number | null;
            /** @description Consecutive Sunday-to-Saturday weeks with an attended class; the current week counts once it has one. */
            streakWeeks: number;
        };
        MonthlyGoalRequest: {
            /** @description Null clears the goal. */
            monthlyGoal: number | null;
        };
        DeleteMeRequest: {
            /** @description The account's email, typed by the person. Compared without case. */
            confirmEmail: string;
        };
        DeleteOrganizationRequest: {
            /** @description The studio's name, typed by the operator. Compared exactly, after trimming. */
            confirmName: string;
        };
        ReportFigures: {
            /** @description Sessions not cancelled that have started. */
            sessionsHeld: number;
            /** @description The places those sessions offered. */
            capacity: number;
            /** @description Bookings on them that held a place: booked, attended or no_show. */
            placesBooked: number;
            attended: number;
            noShow: number;
            /** @description Cancelled by the member after the free-cancel window. */
            lateCancellations: number;
            /** @description attended / capacity, rounded to 3 places; null when no session was held. */
            fillRate: number | null;
        };
        ReportTotals: components["schemas"]["ReportFigures"] & {
            /** @description People with at least one attended class in the period. */
            activeMembers: number;
            /** @description People whose record was created in the period. */
            newMembers: number;
        };
        ReportWeek: components["schemas"]["ReportFigures"] & {
            /**
             * Format: date
             * @description The Sunday that starts the week.
             */
            weekStart: string;
            /**
             * Format: date
             * @description The first day of this week inside the period.
             */
            from: string;
            /**
             * Format: date
             * @description The last day of this week inside the period.
             */
            to: string;
        };
        ReportClassType: components["schemas"]["ReportFigures"] & {
            /** Format: uuid */
            classTypeId: string;
            name: string;
            /** @enum {string} */
            color: "sage" | "rose" | "taupe" | "amber" | "mauve" | "blue";
        };
        ReportSummary: {
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            /** @example Asia/Jerusalem */
            timeZone: string;
            totals: components["schemas"]["ReportTotals"];
            /** @description The same figures for the period of the same length that ends the day before `from`, for the change on each tile. */
            previous: components["schemas"]["ReportTotals"] & {
                /** Format: date */
                from: string;
                /** Format: date */
                to: string;
            };
            /** @description Every Sunday-to-Saturday week that overlaps the period, oldest first, including weeks with nothing held. */
            weeks: components["schemas"]["ReportWeek"][];
            /** @description Class types with at least one session held in the period, by attended, most first. */
            classTypes: components["schemas"]["ReportClassType"][];
        };
        PassEndingRow: {
            /** Format: uuid */
            personId: string;
            displayName: string;
            /** Format: uuid */
            passId: string;
            productName: string;
            /** @enum {string} */
            kind: "punch_card" | "membership";
            /** Format: date */
            endsOn: string;
            /** @description Null for a membership. */
            entriesLeft: number | null;
            /**
             * @description `ends_soon` when it ends within 14 days (that wins when both apply), otherwise `last_entry`.
             * @enum {string}
             */
            reason: "ends_soon" | "last_entry";
        };
        PassesEndingReport: {
            /**
             * Format: date
             * @description Today in the studio's time zone.
             */
            today: string;
            items: components["schemas"]["PassEndingRow"][];
            /** @description True when more than 50 passes match. */
            truncated: boolean;
        };
        MemberAtRiskRow: {
            /** Format: uuid */
            personId: string;
            displayName: string;
            /**
             * Format: date
             * @description Null when the person never attended.
             */
            lastAttendedOn: string | null;
            /**
             * Format: date
             * @description The latest end among the person's valid passes.
             */
            passEndsOn: string;
        };
        MembersAtRiskReport: {
            /**
             * Format: date
             * @description Today in the studio's time zone.
             */
            today: string;
            items: components["schemas"]["MemberAtRiskRow"][];
            /** @description True when more than 50 people match. */
            truncated: boolean;
        };
    };
    responses: {
        /** @description Unexpected error. */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Validation failed; `errors` lists the fields. Phase 2 codes include `contact.required`,
         *     `contact_point.invalid_phone`, `contact_point.invalid_email`, `consent.invalid`, `role_ids.required`,
         *     `role_ids.single`, `role.not_found`, `relationship.invalid_type`, `relationship.self`.
         */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Missing, invalid or wrong-pool token. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Missing, invalid or wrong-pool token, or `auth.step_up_required`: the action needs a sign-in within the
         *     last 10 minutes.
         */
        StepUpOrUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Signed in but not allowed, for example `permission.denied` (the caller lacks the route's permission),
         *     `account.disabled`, `account.email_not_verified`, `membership.suspended`, `organization.suspended`,
         *     `invitation.email_mismatch`, `operator.not_registered`, `auth.mfa_required`, `role.exceeds_actor`,
         *     `membership.forbidden_role_change`, `ownership.target_not_admin`, `status.not_allowed`.
         */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Not found, or not visible to the caller. A studio the caller does not belong to is also 404
         *     (`organization.not_found`), so ids cannot be probed.
         */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description `organization.slug_taken`, `organization.creation_limit`, `concurrency.conflict`,
         *     `ownership.transfer_pending`, `ownership.transfer_stale` (roles changed since the offer; it is cancelled),
         *     `person.has_login`, `person.merge_both_have_login`, `person.read_only` (anonymized or merged),
         *     `contact_point.verified` (the sign-in email changes only with the account), `relationship.exists`,
         *     `health.declaration_required`, `health.form_version_stale`, `health.no_approval_needed`,
         *     `template.has_bookings` (a weekly class with bookings cannot end before its first day).
         */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Too many requests. Invitation and join calls allow 20 per account per hour; other routes are limited at the edge. */
        TooManyRequests: {
            headers: {
                /** @description Seconds until the next attempt is allowed. */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description A dependency the operation needs is not available and the API fails closed, e.g.
         *     `health.key_unavailable` (the health data key cannot be read; docs/31 section 7).
         */
        ServiceUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The studio's subscription is restricted (`billing.restricted`); reads and cancellations still work. */
        Restricted: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        OrganizationId: string;
        MembershipId: string;
        /** @description The `id` of the last item on the previous page. */
        Before: string;
        Limit: number;
        PersonId: string;
        TagId: string;
        NoteId: string;
        /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
        IfMatch: string;
        SubscriptionId: string;
        RoomId: string;
        ClassTypeId: string;
        TemplateId: string;
        SessionId: string;
        BookingId: string;
        ProductId: string;
        PassId: string;
        ItemId: string;
        EntitlementKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The API is up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["Problem"];
        };
    };
    startSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account and its studios. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account and its studios. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description `account.not_provisioned`: call `POST /api/v1/session` first. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteMeRequest"];
            };
        };
        responses: {
            /** @description Deleted. The tokens stop working; the app signs out. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `account.confirmation_mismatch`: `confirmEmail` is not the account's email. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            401: components["responses"]["StepUpOrUnauthorized"];
            404: components["responses"]["NotFound"];
            /** @description `account.sole_owner`: the caller is the only owner of the studios in `organizationIds`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    updateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMeRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOrganizationRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    /** @description URL of the new studio. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Organization"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    previewInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenRequest"];
            };
        };
        responses: {
            /** @description The invitation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPreview"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    acceptInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenRequest"];
            };
        };
        responses: {
            /** @description The membership. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyMembership"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description `invitation.expired` */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: components["responses"]["TooManyRequests"];
        };
    };
    previewJoin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JoinCodeRequest"];
            };
        };
        responses: {
            /** @description The studio. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JoinPreview"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    joinOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JoinCodeRequest"];
            };
        };
        responses: {
            /** @description The membership. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyMembership"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The studio. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Organization"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateOrganization: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOrganizationRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Organization"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMembers: {
        parameters: {
            query?: {
                role?: components["schemas"]["Role"];
                status?: components["schemas"]["MembershipStatus"];
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of members. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    removeMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                membershipId: components["parameters"]["MembershipId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateMember: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                membershipId: components["parameters"]["MembershipId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMemberRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listInvitations: {
        parameters: {
            query?: {
                status?: components["schemas"]["InvitationStatus"];
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of invitations. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateInvitationRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedInvitation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    revokeInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    rotateJoinLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The new link. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JoinLink"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    disableJoinLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disabled. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEventPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    platformListOrganizations: {
        parameters: {
            query?: {
                status?: components["schemas"]["OrganizationStatus"];
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of studios. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOrganizationPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    platformGetOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The studio. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOrganization"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    platformDeleteOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteOrganizationRequest"];
            };
        };
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `organization.name_mismatch`: `confirmName` is not the studio's name. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            401: components["responses"]["StepUpOrUnauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description `organization.not_suspended`, or `organization.suspended_too_recently` (with `deletableFrom`). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    platformSuspendOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonRequest"];
            };
        };
        responses: {
            /** @description Suspended. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOrganization"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    platformReactivateOrganization: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonRequest"];
            };
        };
        responses: {
            /** @description Reactivated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOrganization"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    platformGetStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The counts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformStats"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getMyProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's person record. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateMyProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMyProfileRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    recordMyConsent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordConsentRequest"];
            };
        };
        responses: {
            /** @description Recorded. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consent"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listRoles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All roles. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every permission key with its description. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setMemberRoles: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                membershipId: components["parameters"]["MembershipId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetMemberRolesRequest"];
            };
        };
        responses: {
            /** @description The member with the new roles. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["StepUpOrUnauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getOwnershipTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The pending transfer. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnershipTransfer"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            /** @description `ownership.transfer_not_found`: nothing pending. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    startOwnershipTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartOwnershipTransferRequest"];
            };
        };
        responses: {
            /** @description Started. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnershipTransfer"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["StepUpOrUnauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    cancelOwnershipTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    acceptOwnershipTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's membership, now owner. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyMembership"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description `ownership.transfer_expired` */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    declineOwnershipTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Declined. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPeople: {
        parameters: {
            query?: {
                /** @description Matches name, email or phone (any part). */
                query?: string;
                /** @description Only people with this tag (docs/34 section 7). */
                tag?: string;
                status?: components["schemas"]["PersonStatus"];
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of people. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePersonRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    /** @description URL of the new person. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The person. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updatePerson: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdatePersonRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    addContactPoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateContactPointRequest"];
            };
        };
        responses: {
            /** @description Added. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactPoint"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deleteContactPoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                contactPointId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateContactPoint: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                contactPointId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateContactPointRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactPoint"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listConsentHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The full history. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsentList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    recordConsentOnBehalf: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordConsentRequest"];
            };
        };
        responses: {
            /** @description Recorded. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Consent"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    addRelationship: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRelationshipRequest"];
            };
        };
        responses: {
            /** @description Linked. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Relationship"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deleteRelationship: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                relationshipId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    invitePerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InvitePersonRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedInvitation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    exportPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export. Audited; not stored. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonExport"];
                };
            };
            401: components["responses"]["StepUpOrUnauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    erasePerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonRequest"];
            };
        };
        responses: {
            /** @description Anonymized. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["StepUpOrUnauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    importPeople: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportPeopleRequest"];
            };
        };
        responses: {
            /** @description The outcome of every row and the totals. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportPeopleResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listTags: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every tag (at most 100). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTagRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tag"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    deleteTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateTag: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTagRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tag"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    tagPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The person's tags now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonTagList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    untagPerson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                tagId: components["parameters"]["TagId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The person's tags now. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonTagList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPersonNotes: {
        parameters: {
            query?: {
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of notes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonNotePage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    addPersonNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePersonNoteRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PersonNote"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deletePersonNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
                noteId: components["parameters"]["NoteId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listDuplicateCandidates: {
        parameters: {
            query?: {
                status?: "open" | "merged" | "not_duplicate";
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of candidates. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicateCandidatePage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    resolveDuplicateCandidate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                candidateId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveDuplicateRequest"];
            };
        };
        responses: {
            /** @description Resolved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicateCandidate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    platformForceOwnerTransfer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForceOwnerTransferRequest"];
            };
        };
        responses: {
            /** @description Transferred. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOrganization"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listRooms: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createRoom: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRoomRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Room"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateRoom: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRoomRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Room"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getRoomLayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomLayout"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    saveRoomLayout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoomLayoutRequest"];
            };
        };
        responses: {
            /** @description Saved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoomLayout"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getSessionSpots: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionSpots"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    changeBookingSpot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeSpotRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Booking"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    setUsualSpot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                roomId: components["parameters"]["RoomId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UsualSpotRequest"];
            };
        };
        responses: {
            /** @description Saved. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createBuddyCode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The code. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BuddyCode"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listMyBuddies: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BuddyList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    linkBuddy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LinkBuddyRequest"];
            };
        };
        responses: {
            /** @description Linked. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Buddy"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    unlinkBuddy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unlinked. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listClassTypes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClassTypeList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createClassType: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateClassTypeRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClassType"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateClassType: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                classTypeId: components["parameters"]["ClassTypeId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateClassTypeRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClassType"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listScheduleTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleTemplateList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createScheduleTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateScheduleTemplateRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleTemplateChange"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateScheduleTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                templateId: components["parameters"]["TemplateId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateScheduleTemplateRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduleTemplateChange"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listSessions: {
        parameters: {
            query: {
                /** @description First local date, in the studio's time zone. */
                from: string;
                /** @description Last local date, inclusive. At most 62 days after `from`; members see up to the booking horizon. */
                to: string;
                classTypeId?: string;
                instructorMembershipId?: string;
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSessionRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSessionRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    cancelSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getSessionRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Roster"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    sendSessionMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendSessionMessageRequest"];
            };
        };
        responses: {
            /** @description Accepted. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionMessage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    createBooking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateBookingRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Booking"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    cancelBooking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CancelBookingRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Booking"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    moveBooking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveBookingRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Booking"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    markAttendance: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttendanceRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Booking"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMyBookings: {
        parameters: {
            query?: {
                scope?: "upcoming" | "past";
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyBookingPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getBookingCalendar: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                bookingId: components["parameters"]["BookingId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The calendar file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/calendar": string;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPersonBookings: {
        parameters: {
            query?: {
                scope?: "upcoming" | "past";
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyBookingPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPassProducts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassProductList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createPassProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePassProductRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassProduct"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    archivePassProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassProduct"];
                };
            };
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPersonPasses: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    grantPass: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrantPassRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Pass"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    voidPass: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Pass"];
                };
            };
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    freezePass: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FreezePassRequest"];
            };
        };
        responses: {
            /** @description Frozen; the pass with its freezes. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Pass"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    unfreezePass: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                passId: components["parameters"]["PassId"];
                freezeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Pass"];
                };
            };
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMyPasses: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getBookingPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookingPolicy"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateBookingPolicy: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BookingPolicyInput"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BookingPolicy"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMyNotifications: {
        parameters: {
            query?: {
                /** @description The `id` of the last item on the previous page. */
                before?: components["parameters"]["Before"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InboxPage"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    markAllNotificationsRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Done. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                itemId: components["parameters"]["ItemId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Done. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getMyNotificationPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPreferences"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateMyNotificationPreferences: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationPreferencesInput"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPreferences"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listMyPushSubscriptions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSubscriptionList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    createMyPushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePushSubscriptionRequest"];
            };
        };
        responses: {
            /** @description Already registered. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSubscription"];
                };
            };
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushSubscription"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    deleteMyPushSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                subscriptionId: components["parameters"]["SubscriptionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getVapidPublicKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VapidPublicKey"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    getNotificationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateNotificationSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationSettingsInput"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationSettings"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listNotificationTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationTemplateList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getNotificationTemplate: {
        parameters: {
            query?: {
                locale?: "he" | "en";
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                /** @description A templated kind, e.g. `booking.promoted`; any other answers 404 `template.kind_unknown`. */
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationTemplate"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateNotificationTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                /** @description A templated kind, e.g. `booking.promoted`; any other answers 404 `template.kind_unknown`. */
                kind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationTemplateInput"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationTemplate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getAnnouncementAllowance: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnnouncementAllowance"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    sendAnnouncement: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnnouncementInput"];
            };
        };
        responses: {
            /** @description Sent. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Announcement"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    listPersonDeliveries: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliveryList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getMyHealthDeclaration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyHealthDeclaration"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    signMyHealthDeclaration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignHealthDeclarationRequest"];
            };
        };
        responses: {
            /** @description Signed. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyHealthDeclaration"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getPersonHealthDeclaration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthDeclarationStatusView"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getPersonHealthDeclarationAnswers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    "Cache-Control"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthDeclarationAnswers"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    recordMedicalApproval: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                personId: components["parameters"]["PersonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MedicalApprovalRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthDeclarationStatusView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            402: components["responses"]["Restricted"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getMyProgress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyProgress"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    setMyMonthlyGoal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MonthlyGoalRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyProgress"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getReportSummary: {
        parameters: {
            query?: {
                /** @description First day, in the studio's time zone. Send with `to`, or neither. */
                from?: string;
                /** @description Last day, included. */
                to?: string;
            };
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportSummary"];
                };
            };
            /** @description `report.period_invalid` (one date without the other, or `to` before `from`), `report.period_too_long` (over 92 days). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listPassesEnding: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PassesEndingReport"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listMembersAtRisk: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembersAtRiskReport"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getBilling: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingOverview"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateBillingAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
                "If-Match"?: components["parameters"]["IfMatch"];
            };
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBillingAccountRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingOverview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listPlans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanList"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    platformSetPlan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetPlanRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingOverview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    platformRecordPayment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordPaymentRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingOverview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    platformSetEntitlementOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                organizationId: components["parameters"]["OrganizationId"];
                entitlementKey: components["parameters"]["EntitlementKey"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetEntitlementOverrideRequest"];
            };
        };
        responses: {
            /** @description OK. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BillingOverview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
}
