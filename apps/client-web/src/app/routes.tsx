import type { RouteObject } from "react-router";
import { HomePage } from "../features/home/HomePage";
import { InvitePage } from "../features/invitations/InvitePage";
import { JoinPage } from "../features/join/JoinPage";
import { NotFoundPage } from "./NotFoundPage";

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  // Links are <app>/invite#<token> and <app>/join#<code> (docs/26 section 5.3).
  { path: "/invite", element: <InvitePage /> },
  { path: "/join", element: <JoinPage /> },
  { path: "*", element: <NotFoundPage /> }
];
