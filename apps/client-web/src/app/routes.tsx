import type { RouteObject } from "react-router";
import { RequireAccount } from "../account/RequireAccount";
import { CallbackPage } from "../auth/CallbackPage";
import { LoginPage } from "../auth/LoginPage";
import { RequireAuth } from "../auth/RequireAuth";
import { InvitePage } from "../features/invitations/InvitePage";
import { JoinPage } from "../features/join/JoinPage";
import { BookingsScreen } from "../features/member/BookingsScreen";
import { BookScreen } from "../features/member/BookScreen";
import { HomeScreen } from "../features/member/HomeScreen";
import { MemberLayout } from "../features/member/MemberLayout";
import { ProfileScreen } from "../features/member/ProfileScreen";
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
            // The member screens run on sample data until the studio API exists (features/member/sample.ts);
            // the profile's name, email and studio are real.
            element: <MemberLayout />,
            children: [
              { path: "/", element: <HomeScreen /> },
              { path: "/book", element: <BookScreen /> },
              { path: "/bookings", element: <BookingsScreen /> },
              { path: "/profile", element: <ProfileScreen /> }
            ]
          }
        ]
      }
    ]
  },
  { path: "/login", element: <LoginPage /> },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.clientWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Links are <app>/invite#<token> and <app>/join#<code> (docs/26 section 5.3). Public: a visitor who is not
  // signed in is asked to sign in or sign up first, and the link's secret waits in sessionStorage.
  { path: "/invite", element: <InvitePage /> },
  { path: "/join", element: <JoinPage /> },
  { path: "*", element: <NotFoundPage /> }
];
