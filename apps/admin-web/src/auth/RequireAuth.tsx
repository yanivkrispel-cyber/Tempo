import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";

/** Renders the child routes when signed in; otherwise sends the visitor to `/login`, remembering where they were. */
export function RequireAuth() {
  const { isSignedIn } = useAuth();
  const location = useLocation();
  if (isSignedIn) return <Outlet />;
  // The fragment is dropped on purpose: it can hold an invitation token (docs/26 section 5.3).
  const returnTo = location.pathname + location.search;
  return <Navigate to={returnTo === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
}
