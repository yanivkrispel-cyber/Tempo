import { Navigate } from "react-router";
import { consoleStudios, studioHome, useAccount } from "../../account/account";

/** `/`: straight into the only studio (its day, `studioHome`), or to the list when there are none or several. */
export function HomeRedirect() {
  const studios = consoleStudios(useAccount());
  const only = studios.length === 1 ? studios[0] : undefined;
  return <Navigate to={only ? studioHome(only) : "/select-organization"} replace />;
}
