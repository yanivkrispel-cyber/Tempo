import { Outlet } from "react-router";
import { TabBar, type TabBarLink } from "../../shared/design-system";

const tabs: TabBarLink[] = [
  { to: "/", label: "בית", icon: "home" },
  { to: "/book", label: "מערכת", icon: "calendar" },
  { to: "/bookings", label: "הזמנות", icon: "list" },
  { to: "/profile", label: "פרופיל", icon: "user" },
];

/** The member app's frame: the page, then the fixed bottom tab bar. */
export function MemberLayout() {
  return (
    <>
      <Outlet />
      <TabBar items={tabs} action={{ to: "/book", label: "הרשמה לשיעור", icon: "plus" }} />
    </>
  );
}
