import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { ButtonLink, EmptyState, Skeleton } from "../../shared/design-system";
import { usePublicProducts, type PublicStudio } from "./publicStudio";
import styles from "./public.module.css";

/**
 * A public page: the studio's logo and name at the top, linking to its week, and a small nav to the week and the
 * prices (SL-5).
 */
export function PublicFrame({ studio, children }: { studio: PublicStudio | null; children: ReactNode }) {
  return (
    <main className={`tp-page ${styles.page}`}>
      {studio && <StudioHeader studio={studio} />}
      {children}
    </main>
  );
}

/** "מחירים" shows once the studio lists a product (P-3): an empty prices page is not worth a link. */
function StudioHeader({ studio }: { studio: PublicStudio }) {
  const products = usePublicProducts(studio.slug);
  const hasPrices = (products.data?.length ?? 0) > 0;
  return (
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
        {hasPrices && (
          <NavLink to="/prices" className={styles.navLink}>
            מחירים
          </NavLink>
        )}
      </nav>
    </header>
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
