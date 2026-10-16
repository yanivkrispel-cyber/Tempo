import type { ReactNode } from "react";
import { errorMessage } from "../../api/errors";
import { Banner, Skeleton } from "../design-system";
import { useStudioTimeZone } from "./timeZone";

/** Renders `children` with the studio's time zone once it is known; a skeleton until then, a banner if it fails. */
export function StudioClock({ children }: { children: (timeZone: string) => ReactNode }) {
  const { timeZone, error } = useStudioTimeZone();
  if (timeZone) return <>{children(timeZone)}</>;
  if (error) {
    return (
      <Banner tone="danger" icon="info">
        {errorMessage(error, "לא הצלחנו לטעון את פרטי הסטודיו. נסו שוב.")}
      </Banner>
    );
  }
  return (
    <div aria-busy="true" className="tp-stack">
      <span className="tp-sr-only">טוענים את פרטי הסטודיו…</span>
      <Skeleton height={64} />
    </div>
  );
}
