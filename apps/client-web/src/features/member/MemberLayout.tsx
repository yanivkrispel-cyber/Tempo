import { useEffect } from "react";
import { Outlet, useSearchParams } from "react-router";
import { useMarkRead, useStudio } from "./studio";
import { SideNav, TabBar, type TabBarLink } from "../../shared/design-system";
import { useMediaQuery, WIDE_SCREEN } from "../../shared/useMediaQuery";

const tabs: TabBarLink[] = [
  { to: "/", label: "בית", icon: "home" },
  { to: "/book", label: "מערכת", icon: "calendar" },
  { to: "/bookings", label: "הזמנות", icon: "list" },
  { to: "/profile", label: "פרופיל", icon: "user" },
];

/** A computer has room for the inbox in the menu too; on a phone it is the bell on the home screen. */
const sideTabs: TabBarLink[] = [...tabs.slice(0, 3), { to: "/inbox", label: "התראות", icon: "bell" }, ...tabs.slice(3)];

const book: TabBarLink = { to: "/book", label: "הרשמה לשיעור", icon: "plus" };

/**
 * The member app's frame. On a phone or an upright tablet: the page, then the fixed bottom tab bar. On a computer or a
 * tablet held sideways: the same tabs in a column at the start and the page beside it (D15, #317).
 */
export function MemberLayout() {
  useOpenedNotification();
  const wide = useMediaQuery(WIDE_SCREEN);
  const studio = useStudio();

  if (!wide) {
    return (
      <>
        <Outlet />
        <TabBar items={tabs} action={book} />
      </>
    );
  }
  return (
    <div className="tp-app">
      <SideNav
        items={sideTabs}
        action={book}
        header={
          <div className="tp-sidenav__head">
            <span className="tp-rail__logo tp-rail__logo--sm" aria-hidden="true">
              {(studio?.name ?? "Tempo").replace(/^סטודיו\s+/, "").charAt(0)}
            </span>
            <strong>{studio?.name ?? "Tempo"}</strong>
          </div>
        }
      />
      <Outlet />
    </div>
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
