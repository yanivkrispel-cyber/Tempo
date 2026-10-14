import type { RouteObject } from "react-router";
import { HomePage } from "../features/home/HomePage";
import { InvitePage } from "../features/invitations/InvitePage";
import { NotFoundPage } from "./NotFoundPage";

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  // Staff and admin invitations open here as <app>/invite#<token> (docs/26 section 5.3).
  // Join links are for clients and open the client app.
  { path: "/invite", element: <InvitePage /> },
  { path: "*", element: <NotFoundPage /> }
];
