import type { RouteObject } from "react-router";
import { RequireAccount } from "../account/RequireAccount";
import { CallbackPage } from "../auth/CallbackPage";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { InvitePage } from "../features/invitations/InvitePage";
import { JoinPage } from "../features/join/JoinPage";
import { BookingsScreen } from "../features/member/BookingsScreen";
import { BookScreen } from "../features/member/BookScreen";
import { ClassScreen } from "../features/member/ClassScreen";
import { HealthDeclarationScreen } from "../features/member/HealthDeclarationScreen";
import { HomeScreen } from "../features/member/HomeScreen";
import { InboxScreen } from "../features/member/InboxScreen";
import { MemberLayout } from "../features/member/MemberLayout";
import { PublicClassPage } from "../features/public/PublicClassPage";
import { PublicWeekPage } from "../features/public/PublicStudioPage";
import { ProfileScreen } from "../features/member/ProfileScreen";
import { NotificationsScreen } from "../features/member/NotificationsScreen";
import { NotFoundPage } from "./NotFoundPage";

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
              { path: "/", element: <HomeScreen /> },
              { path: "/book", element: <BookScreen /> },
              { path: "/classes/:sessionId", element: <ClassScreen /> },
              { path: "/bookings", element: <BookingsScreen /> },
              { path: "/inbox", element: <InboxScreen /> },
              { path: "/profile", element: <ProfileScreen /> },
              { path: "/profile/notifications", element: <NotificationsScreen /> },
              { path: "/profile/health", element: <HealthDeclarationScreen /> },
            ],
          },
        ],
      },
    ],
  },
  // A studio's public pages under `/s/<slug>/` (docs/37 section 4.1): open to anyone; a member is sent on to the
  // member app's own screens. `/` is the public page for a visitor, from <RequireAuth>.
  { path: "/c/:sessionId", element: <PublicClassPage /> },
  { path: "/week/:date", element: <PublicWeekPage /> },
  { path: "/login", element: <LoginPage /> },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.clientWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Links are <app>/invite#<token> and <app>/join#<code> (docs/26 section 5.3). Public: a visitor who is not
  // signed in is asked to sign in or sign up first, and the link's secret waits in sessionStorage.
  { path: "/invite", element: <InvitePage /> },
  { path: "/join", element: <JoinPage /> },
  { path: "*", element: <NotFoundPage /> },
];
