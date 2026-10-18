import { useEffect, useRef, useState, type MouseEvent } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { consoleStudios, membershipRoleName, permissionsOf, useAccount } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ButtonLink, EmptyState, Icon, IconButton, cx, type IconName } from "../../shared/design-system";
import { useMediaQuery, WIDE_SCREEN } from "../../shared/useMediaQuery";
import { IncomingTransferBanner } from "../ownership/Ownership";
import { securityPath } from "../security/SecurityPage";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import styles from "./console.module.css";
import { ConsoleNotices } from "./ConsoleNotices";
import { StudioContext, type Studio } from "./studio";

interface Section {
  to: string;
  label: string;
  icon: IconName;
  /** Shown only to members who hold it. */
  permission: string;
  /** On the bottom bar of a phone or an upright tablet, under this shorter name. */
  quick?: string;
}

const sections: Section[] = [
  { to: "today", label: "היום בסטודיו", icon: "calendar-day", permission: "schedule.view", quick: "היום" },
  { to: "", label: "חברי הסטודיו", icon: "users", permission: "members.view" },
  { to: "reports", label: "דוחות", icon: "bar-chart", permission: "reports.view", quick: "דוחות" },
  { to: "schedule", label: "מערכת שבועית", icon: "calendar", permission: "schedule.view", quick: "מערכת" },
  { to: "weekly-classes", label: "שיעורים קבועים", icon: "clock", permission: "schedule.manage" },
  { to: "class-types", label: "סוגי שיעורים", icon: "list", permission: "schedule.view" },
  { to: "rooms", label: "חדרים", icon: "home", permission: "schedule.view" },
  { to: "passes", label: "כרטיסיות ומנויים", icon: "credit-card", permission: "passes.view" },
  { to: "people", label: "אנשים", icon: "user", permission: "people.view", quick: "אנשים" },
  { to: "duplicates", label: "כפילויות", icon: "users", permission: "people.merge" },
  { to: "invitations", label: "הזמנות", icon: "mail", permission: "members.invite.staff" },
  { to: "roles", label: "תפקידים", icon: "shield", permission: "members.view" },
  { to: "audit", label: "יומן פעולות", icon: "list", permission: "audit.view" },
  { to: "settings", label: "הגדרות", icon: "settings", permission: "organization.settings.manage" },
];

/** The bottom bar's order: what a coach or an owner opens most on the studio floor. */
const quickOrder = ["today", "schedule", "people", "reports"];

/** `/o/:slug/*`: the studio from the URL, its navigation, and the page. */
export function ConsoleLayout() {
  const { slug } = useParams();
  const me = useAccount();
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
      <ConsoleFrame studio={studio} switchable={studios.length > 1} />
    </StudioContext.Provider>
  );
}

/**
 * On a computer or a tablet held sideways the menu stays at the start and the page sits beside it. Narrower (a phone,
 * an upright tablet) the page takes the whole width under a top bar, the most used sections sit on a bottom bar, and
 * the full menu slides in from the top bar's menu button or the bottom bar's "עוד" (D15, #317).
 */
function ConsoleFrame({ studio, switchable }: { studio: Studio; switchable: boolean }) {
  const { client } = useAuth();
  const wide = useMediaQuery(WIDE_SCREEN, true);
  const [menuOpen, setMenuOpen] = useState(false);
  const palette = useCommandPalette();
  // A tablet turned sideways while the menu is open keeps the menu on screen, so it is no longer "open".
  const open = !wide && menuOpen;
  const opener = useRef<HTMLElement | null>(null);
  const menu = useRef<HTMLElement>(null);
  // Set when the menu closes by its close button, Escape or the scrim, which hand focus back to the opener.
  const refocus = useRef(false);

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    opener.current = event.currentTarget;
    setMenuOpen(true);
  };

  const closeMenu = () => {
    refocus.current = true;
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!open) {
      // Only once the close is on screen: until then the opener's bar is inert, and a browser ignores focus() there.
      if (refocus.current) opener.current?.focus();
      refocus.current = false;
      return;
    }
    menu.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      refocus.current = true;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const visible = sections.filter((section) => studio.can(section.permission));
  const quick = quickOrder
    .map((to) => visible.find((section) => section.to === to))
    .filter((section): section is Section => section !== undefined);

  return (
    <div className={styles.frame}>
      {!wide && (
        <header className="tp-appbar" inert={open}>
          <IconButton
            icon="menu"
            label="התפריט של הסטודיו"
            aria-expanded={open}
            aria-controls="console-menu"
            onClick={openMenu}
          />
          <span className="tp-appbar__title">
            <StudioLogo studio={studio} />
            <span>{studio.displayName}</span>
          </span>
          <IconButton icon="search" label="חיפוש" onClick={() => palette.setOpen(true)} />
        </header>
      )}

      {open && <div className={cx("tp-scrim", styles.scrim)} aria-hidden="true" onClick={closeMenu} />}

      <aside
        id="console-menu"
        ref={menu}
        className={cx(styles.side, !wide && "tp-drawer")}
        data-open={open || undefined}
        aria-label={wide ? undefined : "התפריט של הסטודיו"}
        tabIndex={wide ? undefined : -1}
      >
        <div className={styles.sideHead}>
          <div className={`tp-card tp-card--sm ${styles.studio}`}>
            <StudioLogo studio={studio} />
            <span className={styles.studioName}>
              <strong>{studio.displayName}</strong>
              <span className="tp-caption tp-muted">{membershipRoleName(studio.membership)}</span>
            </span>
          </div>
          {!wide && <IconButton icon="close" label="סגירת התפריט" onClick={closeMenu} />}
        </div>
        {wide && (
          <button type="button" className={styles.search} onClick={() => palette.setOpen(true)}>
            <Icon name="search" />
            <span>חיפוש</span>
            <kbd className="tp-kbd" dir="ltr">
              Ctrl K
            </kbd>
          </button>
        )}
        <nav className="tp-nav" aria-label="ניהול הסטודיו">
          {visible.map((section) => (
            // The timetable stays current on a class's own page (schedule/sessions/...).
            <NavLink
              key={section.to}
              to={section.to}
              end={section.to !== "schedule"}
              className="tp-nav__item"
              onClick={() => setMenuOpen(false)}
            >
              <Icon name={section.icon} />
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="tp-stack" style={{ gap: 4 }}>
          {switchable && (
            <ButtonLink to="/select-organization" variant="ghost" size="sm" icon="home">
              החלפת סטודיו
            </ButtonLink>
          )}
          <ButtonLink to={securityPath} variant="ghost" size="sm" icon="shield">
            אבטחת החשבון
          </ButtonLink>
          <Button variant="ghost" size="sm" icon="log-out" onClick={() => client?.signOut()}>
            התנתקות
          </Button>
        </div>
      </aside>

      <div className={styles.content} inert={open}>
        <ConsoleNotices />
        <IncomingTransferBanner />
        <Outlet />
      </div>

      {palette.open && <CommandPalette sections={visible} onClose={() => palette.setOpen(false)} />}

      {!wide && (
        <nav className={cx("tp-tabbar tp-tabbar--fixed", styles.tabbar)} aria-label="קיצורי דרך" inert={open}>
          {quick.map((section) => (
            <NavLink key={section.to} to={section.to} end={section.to !== "schedule"} className="tp-tabbar__item">
              <Icon name={section.icon} />
              {section.quick}
            </NavLink>
          ))}
          <button
            type="button"
            className="tp-tabbar__item"
            aria-expanded={open}
            aria-controls="console-menu"
            onClick={openMenu}
          >
            <Icon name="menu" />
            עוד
          </button>
        </nav>
      )}
    </div>
  );
}

function StudioLogo({ studio }: { studio: Studio }) {
  return (
    <span className="tp-rail__logo tp-rail__logo--sm" aria-hidden="true">
      {studio.displayName.replace(/^סטודיו\s+/, "").charAt(0)}
    </span>
  );
}
