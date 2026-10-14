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
            role: components["schemas"]["Role"];
            status: components["schemas"]["MembershipStatus"];
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
            role: components["schemas"]["Role"];
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
        /** @description Validation failed; `errors` lists the fields. */
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
         * @description Signed in but not allowed, for example `permission.denied` (the caller's role does not allow it),
         *     `account.disabled`, `account.email_not_verified`, `membership.suspended`, `organization.suspended`,
         *     `invitation.email_mismatch`, `operator.not_registered`.
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
        /** @description `organization.slug_taken`, `organization.creation_limit` or `concurrency.conflict`. */
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
    };
    parameters: {
        OrganizationId: string;
        MembershipId: string;
        /** @description The `id` of the last item on the previous page. */
        Before: string;
        Limit: number;
        /** @description The `version` you last read. A stale value returns 409 `concurrency.conflict`. */
        IfMatch: string;
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
}
