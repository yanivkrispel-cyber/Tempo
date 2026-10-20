import { Navigate, Outlet, useLocation } from "react-router";
import { useStudioPath } from "../app/studioPath";
import { PublicStudioPage } from "../features/public/PublicStudioPage";
import { useAuth } from "./AuthProvider";

/**
 * Renders the child routes when signed in; otherwise sends the visitor to `/login`, remembering where they were. The
 * front page of a studio's own app is its public page instead (docs/37 section 4.1).
 */
export function RequireAuth() {
  const { isSignedIn } = useAuth();
  const location = useLocation();
  const studioPath = useStudioPath();
  if (isSignedIn) return <Outlet />;
  if (studioPath && location.pathname === "/") return <PublicStudioPage />;
  // The fragment is dropped on purpose: it can hold an invitation token (docs/26 section 5.3).
  const returnTo = location.pathname + location.search;
  return <Navigate to={returnTo === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}
