import { NavLink, Outlet, useParams } from "react-router";
import { consoleStudios, membershipRoleName, permissionsOf, useAccount } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ButtonLink, EmptyState, Icon, type IconName } from "../../shared/design-system";
import { IncomingTransferBanner } from "../ownership/Ownership";
import styles from "./console.module.css";
import { StudioContext, type Studio } from "./studio";

interface Section {
  to: string;
  label: string;
  icon: IconName;
  /** Shown only to members who hold it. */
  permission: string;
}

const sections: Section[] = [
  { to: "", label: "חברי הסטודיו", icon: "users", permission: "members.view" },
  { to: "schedule", label: "מערכת שבועית", icon: "calendar", permission: "schedule.view" },
  { to: "weekly-classes", label: "שיעורים קבועים", icon: "clock", permission: "schedule.manage" },
  { to: "class-types", label: "סוגי שיעורים", icon: "list", permission: "schedule.view" },
  { to: "rooms", label: "חדרים", icon: "home", permission: "schedule.view" },
  { to: "people", label: "אנשים", icon: "user", permission: "people.view" },
  { to: "duplicates", label: "כפילויות", icon: "users", permission: "people.merge" },
  { to: "invitations", label: "הזמנות", icon: "mail", permission: "members.invite.staff" },
  { to: "roles", label: "תפקידים", icon: "shield", permission: "members.view" },
  { to: "audit", label: "יומן פעולות", icon: "list", permission: "audit.view" },
  { to: "settings", label: "הגדרות", icon: "settings", permission: "organization.settings.manage" },
];

/** `/o/:slug/*`: the studio from the URL, its navigation, and the page. */
export function ConsoleLayout() {
  const { slug } = useParams();
  const me = useAccount();
  const { client } = useAuth();
  const studios = consoleStudios(me);
  const membership = studios.find((candidate) => candidate.organization.slug === slug);

  if (!membership) {
    return (
      <main className="tp-page">
        <EmptyState
          title="הסטודיו לא נמצא"
          titleAs="h1"
          icon="info"
          action={
            <ButtonLink to="/select-organization" variant="secondary">
              לרשימת הסטודיואים
            </ButtonLink>
          }
        >
          ייתכן שהכתובת שגויה, או שאין לך גישה לניהול הסטודיו הזה.
        </EmptyState>
      </main>
    );
  }

  const permissions = permissionsOf(membership);
  const studio: Studio = {
    organizationId: membership.organization.id,
    slug: membership.organization.slug,
    displayName: membership.organization.displayName,
    membership,
    can: (permission) => permissions.has(permission),
  };

  return (
    <StudioContext.Provider value={studio}>
      <div className={styles.frame}>
        <aside className={styles.side}>
          <div className={`tp-card tp-card--sm ${styles.studio}`}>
            <span className="tp-rail__logo tp-rail__logo--sm" aria-hidden="true">
              {studio.displayName.replace(/^סטודיו\s+/, "").charAt(0)}
            </span>
            <span className={styles.studioName}>
              <strong>{studio.displayName}</strong>
              <span className="tp-caption tp-muted">{membershipRoleName(membership)}</span>
            </span>
          </div>
          <nav className="tp-nav" aria-label="ניהול הסטודיו">
            {sections
              .filter((section) => studio.can(section.permission))
              .map((section) => (
                // The timetable stays current on a class's own page (schedule/sessions/...).
                <NavLink key={section.to} to={section.to} end={section.to !== "schedule"} className="tp-nav__item">
                  <Icon name={section.icon} />
                  {section.label}
                </NavLink>
              ))}
          </nav>
          <div className="tp-stack" style={{ gap: 4 }}>
            {studios.length > 1 && (
              <ButtonLink to="/select-organization" variant="ghost" size="sm" icon="home">
                החלפת סטודיו
              </ButtonLink>
            )}
            <Button variant="ghost" size="sm" icon="log-out" onClick={() => client?.signOut()}>
              התנתקות
            </Button>
          </div>
        </aside>
        <div className={styles.content}>
          <IncomingTransferBanner />
          <Outlet />
        </div>
      </div>
    </StudioContext.Provider>
  );
}
