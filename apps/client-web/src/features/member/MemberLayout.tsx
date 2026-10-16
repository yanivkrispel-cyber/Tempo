import { useEffect } from "react";
import { Outlet, useSearchParams } from "react-router";
import { useMarkRead } from "./studio";
import { TabBar, type TabBarLink } from "../../shared/design-system";

const tabs: TabBarLink[] = [
  { to: "/", label: "בית", icon: "home" },
  { to: "/book", label: "מערכת", icon: "calendar" },
  { to: "/bookings", label: "הזמנות", icon: "list" },
  { to: "/profile", label: "פרופיל", icon: "user" },
];

/** The member app's frame: the page, then the fixed bottom tab bar. */
export function MemberLayout() {
  useOpenedNotification();
  return (
    <>
      <Outlet />
      <TabBar items={tabs} action={{ to: "/book", label: "הרשמה לשיעור", icon: "plus" }} />
    </>
  );
}

/**
 * A tapped push notification opens `/inbox` or the class with `?studio=…&notification=…` (public/sw.js): mark that
 * inbox item read, then drop the parameters.
 */
function useOpenedNotification() {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get("studio");
  const itemId = params.get("notification");
  const markRead = useMarkRead(organizationId ?? "");
  const { mutate } = markRead;

  useEffect(() => {
    if (!organizationId || !itemId) return;
    mutate(itemId);
    setParams(
      (current) => {
        current.delete("studio");
        current.delete("notification");
        return current;
      },
      { replace: true },
    );
  }, [organizationId, itemId, mutate, setParams]);
}
