import type { RouteObject } from "react-router";
import { RequireAccount } from "../account/RequireAccount";
import { CallbackPage } from "../auth/CallbackPage";
import { AuditPage } from "../features/audit/AuditPage";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { ConsoleLayout } from "../features/console/ConsoleLayout";
import { InvitationsPage } from "../features/invitations/InvitationsPage";
import { InvitePage } from "../features/invitations/InvitePage";
import { MembersPage } from "../features/members/MembersPage";
import { DuplicatesPage } from "../features/people/DuplicatesPage";
import { PeoplePage } from "../features/people/PeoplePage";
import { PersonPage } from "../features/people/PersonPage";
import { RolesPage } from "../features/roles/RolesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { HomeRedirect } from "../features/studios/HomeRedirect";
import { SelectStudioPage } from "../features/studios/SelectStudioPage";
import { NotFoundPage } from "./NotFoundPage";

// docs/06 section 5: /login, /select-organization, /o/:organizationSlug/...
export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        // POST /api/v1/session first: it creates the account on the first sign-in (docs/26 section 2.3).
        element: <RequireAccount />,
        children: [
          { path: "/", element: <HomeRedirect /> },
          { path: "/select-organization", element: <SelectStudioPage /> },
          {
            path: "/o/:slug",
            element: <ConsoleLayout />,
            children: [
              { index: true, element: <MembersPage /> },
              { path: "invitations", element: <InvitationsPage /> },
              { path: "roles", element: <RolesPage /> },
              { path: "people", element: <PeoplePage /> },
              { path: "people/:personId", element: <PersonPage /> },
              { path: "duplicates", element: <DuplicatesPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "audit", element: <AuditPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "/login", element: <LoginPage /> },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.adminWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Staff and admin invitations open here as <app>/invite#<token> (docs/26 section 5.3). Join links are for
  // clients and open the client app. Public: a visitor who is not signed in signs in or up first.
  { path: "/invite", element: <InvitePage /> },
  { path: "*", element: <NotFoundPage /> },
];
