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
import { PublishPage } from "../features/publish/PublishPage";
import { PassProductsPage } from "../features/passes/PassProductsPage";
import { ImportPage } from "../features/import/ImportPage";
import { DuplicatesPage } from "../features/people/DuplicatesPage";
import { PeoplePage } from "../features/people/PeoplePage";
import { PersonPage } from "../features/people/PersonPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { RolesPage } from "../features/roles/RolesPage";
import { ClassTypesPage } from "../features/schedule/ClassTypesPage";
import { RoomsPage } from "../features/schedule/RoomsPage";
import { SchedulePage } from "../features/schedule/SchedulePage";
import { SessionPage } from "../features/schedule/SessionPage";
import { TemplatesPage } from "../features/schedule/TemplatesPage";
import { SecurityPage } from "../features/security/SecurityPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TemplatePage } from "../features/settings/TemplatePage";
import { HomeRedirect } from "../features/studios/HomeRedirect";
import { SelectStudioPage } from "../features/studios/SelectStudioPage";
import { TodayPage } from "../features/today/TodayPage";
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
          // The account, not a studio: two-step sign-in setup (docs/27 section 3.6).
          { path: "/account/security", element: <SecurityPage /> },
          {
            path: "/o/:slug",
            element: <ConsoleLayout />,
            children: [
              { index: true, element: <MembersPage /> },
              { path: "today", element: <TodayPage /> },
              { path: "invitations", element: <InvitationsPage /> },
              { path: "roles", element: <RolesPage /> },
              { path: "people", element: <PeoplePage /> },
              { path: "people/import", element: <ImportPage /> },
              { path: "people/:personId", element: <PersonPage /> },
              { path: "duplicates", element: <DuplicatesPage /> },
              { path: "schedule", element: <SchedulePage /> },
              { path: "schedule/sessions/:sessionId", element: <SessionPage /> },
              { path: "weekly-classes", element: <TemplatesPage /> },
              { path: "class-types", element: <ClassTypesPage /> },
              { path: "rooms", element: <RoomsPage /> },
              { path: "passes", element: <PassProductsPage /> },
              { path: "publish", element: <PublishPage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "settings/templates/:kind", element: <TemplatePage /> },
              { path: "audit", element: <AuditPage /> },
              { path: "reports", element: <ReportsPage /> },
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
