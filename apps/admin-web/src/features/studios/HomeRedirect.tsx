import { Navigate, useLocation } from "react-router";
import { consoleStudios, studioHome, useAccount } from "../../account/account";

/**
 * `/`: straight into the only studio (its day, `studioHome`), or to the list when there are none or several. The
 * query goes along, so the installed app's shortcuts (`/?open=scan`, manifest.webmanifest) reach the day.
 */
export function HomeRedirect() {
  const studios = consoleStudios(useAccount());
  const { search } = useLocation();
  const only = studios.length === 1 ? studios[0] : undefined;
  return <Navigate to={only ? studioHome(only) + search : "/select-organization"} replace />;
}
