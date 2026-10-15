import type { ReactNode } from "react";
import { Button, EmptyState, Skeleton } from "../../shared/design-system";
import { errorMessage } from "../../api/errors";
import styles from "./member.module.css";

/** A screen with no studio yet: the member signed up but has not joined one. */
export function NoStudio({ title }: { title: string }) {
  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <h1 className={styles.title}>{title}</h1>
      <EmptyState icon="calendar" title="עוד לא הצטרפת לסטודיו">
        בקשו מהסטודיו קישור הצטרפות או הזמנה במייל.
      </EmptyState>
    </main>
  );
}

/** The loading placeholder of a list. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={84} />
      ))}
    </div>
  );
}

/** A failed read, in Hebrew, with a way to try again. */
export function LoadError({ error, onRetry, children }: { error: unknown; onRetry: () => void; children?: ReactNode }) {
  return (
    <EmptyState
      icon="info"
      title={children ?? "לא הצלחנו לטעון"}
      action={
        <Button variant="secondary" onClick={onRetry}>
          נסו שוב
        </Button>
      }
    >
      {errorMessage(error)}
    </EmptyState>
  );
}
