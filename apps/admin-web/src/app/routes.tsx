import type { RouteObject } from "react-router";
import { RequireAccount } from "../account/RequireAccount";
import { CallbackPage } from "../auth/CallbackPage";
import { RequireAuth } from "../auth/RequireAuth";
import { ConsoleLayout } from "../features/console/ConsoleLayout";
import { HomeRedirect } from "../features/studios/HomeRedirect";
import { lazyScreen } from "./lazyScreen";
import { NotFoundPage } from "./NotFoundPage";

// docs/06 section 5: /login, /select-organization, /o/:organizationSlug/...
// Every page is its own chunk (board #511, S-3); the frame, the guards and the sign-in callback stay in the entry.
export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        // POST /api/v1/session first: it creates the account on the first sign-in (docs/26 section 2.3).
        element: <RequireAccount />,
        children: [
          { path: "/", element: <HomeRedirect /> },
          {
            path: "/select-organization",
            ...lazyScreen(() => import("../features/studios/SelectStudioPage"), "SelectStudioPage"),
          },
          // The account, not a studio: two-step sign-in setup (docs/27 section 3.6).
          {
            path: "/account/security",
            ...lazyScreen(() => import("../features/security/SecurityPage"), "SecurityPage"),
          },
          {
            path: "/o/:slug",
            element: <ConsoleLayout />,
            children: [
              { index: true, ...lazyScreen(() => import("../features/members/MembersPage"), "MembersPage") },
              { path: "today", ...lazyScreen(() => import("../features/today/TodayPage"), "TodayPage") },
              {
                path: "invitations",
                ...lazyScreen(() => import("../features/invitations/InvitationsPage"), "InvitationsPage"),
              },
              { path: "roles", ...lazyScreen(() => import("../features/roles/RolesPage"), "RolesPage") },
              { path: "people", ...lazyScreen(() => import("../features/people/PeoplePage"), "PeoplePage") },
              { path: "people/import", ...lazyScreen(() => import("../features/import/ImportPage"), "ImportPage") },
              { path: "people/:personId", ...lazyScreen(() => import("../features/people/PersonPage"), "PersonPage") },
              {
                path: "duplicates",
                ...lazyScreen(() => import("../features/people/DuplicatesPage"), "DuplicatesPage"),
              },
              { path: "schedule", ...lazyScreen(() => import("../features/schedule/SchedulePage"), "SchedulePage") },
              {
                path: "schedule/sessions/:sessionId",
                ...lazyScreen(() => import("../features/schedule/SessionPage"), "SessionPage"),
              },
              {
                path: "live/:sessionId",
                ...lazyScreen(() => import("../features/schedule/OwnerLivePage"), "OwnerLivePage"),
              },
              {
                path: "weekly-classes",
                ...lazyScreen(() => import("../features/schedule/TemplatesPage"), "TemplatesPage"),
              },
              {
                path: "class-types",
                ...lazyScreen(() => import("../features/schedule/ClassTypesPage"), "ClassTypesPage"),
              },
              { path: "rooms", ...lazyScreen(() => import("../features/schedule/RoomsPage"), "RoomsPage") },
              {
                path: "passes",
                ...lazyScreen(() => import("../features/passes/PassProductsPage"), "PassProductsPage"),
              },
              { path: "publish", ...lazyScreen(() => import("../features/publish/PublishPage"), "PublishPage") },
              { path: "settings", ...lazyScreen(() => import("../features/settings/SettingsPage"), "SettingsPage") },
              {
                path: "settings/templates/:kind",
                ...lazyScreen(() => import("../features/settings/TemplatePage"), "TemplatePage"),
              },
              { path: "audit", ...lazyScreen(() => import("../features/audit/AuditPage"), "AuditPage") },
              { path: "reports", ...lazyScreen(() => import("../features/reports/ReportsPage"), "ReportsPage") },
            ],
          },
        ],
      },
    ],
  },
  { path: "/login", ...lazyScreen(() => import("../auth/LoginPage"), "LoginPage") },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.adminWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Staff and admin invitations open here as <app>/invite#<token> (docs/26 section 5.3). Join links are for
  // clients and open the client app. Public: a visitor who is not signed in signs in or up first.
  { path: "/invite", ...lazyScreen(() => import("../features/invitations/InvitePage"), "InvitePage") },
  { path: "*", element: <NotFoundPage /> },
];
