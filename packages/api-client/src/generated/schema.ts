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
        delete?: never;
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
        delete?: never;
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
         * @description 404 codes: `pass.not_found`, `pass.freeze_not_found`. 409 codes: `pass.freeze_started` (a freeze that already started stays), `pass.voided`, `pass.not_freezable`.
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
        };
        CreateBookingRequest: {
            /**
             * Format: uuid
             * @description Book someone else (`bookings.manage`). Omit to book yourself.
             */
            personId?: string;
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
            version: string;
        };
        BookingPolicyInput: {
            freeCancelHours: number;
            waitlistCutoffHours: number;
            bookingHorizonDays: number;
            waitlistEnabled: boolean;
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
             */
            kind: string;
            /** @description Ids only. */
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
            /** @description For `session.message`, the staff message (docs/29 section 16.2); null for every other kind. */
            text?: string | null;
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
         *     `contact_point.verified` (the sign-in email changes only with the account), `relationship.exists`.
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
        /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
        IfMatch: string;
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
