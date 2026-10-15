import type { RouteObject } from "react-router";
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
        // The member screens run on sample data until the studio API exists (features/member/sample.ts).
        element: <MemberLayout />,
        children: [
          { path: "/", element: <HomeScreen /> },
          { path: "/book", element: <BookScreen /> },
          { path: "/bookings", element: <BookingsScreen /> },
          { path: "/profile", element: <ProfileScreen /> }
        ]
      }
    ]
  },
  { path: "/login", element: <LoginPage /> },
  // Cognito's exact callback URL (infrastructure/config/<env>.ts, cognitoCallbackUrls.clientWeb).
  { path: "/auth/callback", element: <CallbackPage /> },
  // Links are <app>/invite#<token> and <app>/join#<code> (docs/26 section 5.3).
  { path: "/invite", element: <InvitePage /> },
  { path: "/join", element: <JoinPage /> },
  { path: "*", element: <NotFoundPage /> }
];
