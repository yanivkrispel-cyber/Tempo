import type { RouteObject } from "react-router";
import { RequireAccount } from "../account/RequireAccount";
import { CallbackPage } from "../auth/CallbackPage";
import { RequireAuth } from "../auth/RequireAuth";
import { MemberLayout } from "../features/member/MemberLayout";
import { lazyScreen } from "./lazyScreen";
import { NotFoundPage } from "./NotFoundPage";

// Every screen is its own chunk (board #511, S-3); the frame, the guards and the sign-in callback stay in the entry.
export const routes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        // POST /api/v1/session first: it creates the account on the first sign-in (docs/26 section 2.3).
        element: <RequireAccount />,
        children: [
          {
            // Every member screen reads the studio API: docs/29 (timetable, bookings, waitlist), docs/30 (inbox,
            // preferences) and docs/31 (health declaration, progress).
            element: <MemberLayout />,
            children: [
              { path: "/", ...lazyScreen(() => import("../features/member/HomeScreen"), "HomeScreen") },
              { path: "/book", ...lazyScreen(() => import("../features/member/BookScreen"), "BookScreen") },
              {
                path: "/classes/:sessionId",
                ...lazyScreen(() => import("../features/member/ClassScreen"), "ClassScreen"),
              },
              { path: "/bookings", ...lazyScreen(() => import("../features/member/BookingsScreen"), "BookingsScreen") },
              { path: "/inbox", ...lazyScreen(() => import("../features/member/InboxScreen"), "InboxScreen") },
              {
                path: "/milestone/:count",
                ...lazyScreen(() => import("../features/member/MilestoneScreen"), "MilestoneScreen"),
              },
              { path: "/profile", ...lazyScreen(() => import("../features/member/ProfileScreen"), "ProfileScreen") },
              {
                path: "/profile/notifications",
                ...lazyScreen(() => import("../features/member/NotificationsScreen"), "NotificationsScreen"),
              },
              {
                path: "/profile/health",
                ...lazyScreen(() => import("../features/member/HealthDeclarationScreen"), "HealthDeclarationScreen"),
              },
            ],
          },
        ],
      },
    ],
  },
  // A studio's public pages under `/s/<slug>/` (docs/37 section 4.1): open to anyone; a member is sent on to the
  // member app's own screens. `/` is the public page for a visitor, from <RequireAuth>.
  { path: "/c/:sessionId", ...lazyScreen(() => import("../features/public/PublicClassPage"), "PublicClassPage") },
  { path: "/week/:date", ...lazyScreen(() => import("../features/public/PublicStudioPage"), "PublicWeekPage") },
  { path: "/o/:productId", ...lazyScreen(() => import("../features/public/PublicOfferPage"), "PublicOfferPage") },
  { path: "/prices", ...lazyScreen(() => import("../features/public/PublicPricesPage"), "PublicPricesPage") },
  { path: "/login", ...lazyScreen(() => import("../auth/LoginPage"), "LoginPage") },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.clientWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Links are <app>/invite#<token> and <app>/join#<code> (docs/26 section 5.3). Public: a visitor who is not
  // signed in is asked to sign in or sign up first, and the link's secret waits in sessionStorage.
  { path: "/invite", ...lazyScreen(() => import("../features/invitations/InvitePage"), "InvitePage") },
  { path: "/join", ...lazyScreen(() => import("../features/join/JoinPage"), "JoinPage") },
  { path: "*", element: <NotFoundPage /> },
];
