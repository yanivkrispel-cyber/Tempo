import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { ButtonLink, EmptyState, Skeleton } from "../../shared/design-system";
import type { PublicStudio } from "./publicStudio";
import styles from "./public.module.css";

/**
 * A public page: the studio's logo and name at the top, linking to its week, and a small nav to the week and the
 * prices (SL-5).
 */
export function PublicFrame({ studio, children }: { studio: PublicStudio | null; children: ReactNode }) {
  return (
    <main className={`tp-page ${styles.page}`}>
      {studio && (
        <header className={styles.header}>
          <Link to="/" className={styles.brand}>
            {studio.logoUrl && <img src={studio.logoUrl} alt="" />}
            <span>
              <bdi>{studio.name}</bdi>
            </span>
          </Link>
          <nav className={styles.nav} aria-label="עמודי הסטודיו">
            <NavLink to="/" end className={styles.navLink}>
              מערכת
            </NavLink>
            <NavLink to="/prices" className={styles.navLink}>
              מחירים
            </NavLink>
          </nav>
        </header>
      )}
      {children}
    </main>
  );
}

export function PublicSkeleton() {
  return (
    <main className={`tp-page ${styles.page}`} aria-busy="true">
      <Skeleton height={36} width={160} />
      <Skeleton height={240} />
      <Skeleton height={84} />
    </main>
  );
}

/** An unknown studio, or one whose public page is off (docs/37 section 4.1). */
export function StudioNotFound() {
  return (
    <main className="tp-page tp-page--center">
      <EmptyState
        icon="info"
        title="הסטודיו לא נמצא"
        titleAs="h1"
        action={
          <ButtonLink to="/login" variant="secondary">
            כניסה לחשבון
          </ButtonLink>
        }
      >
        ייתכן שהקישור שגוי או שהעמוד של הסטודיו לא פעיל.
      </EmptyState>
    </main>
  );
}
