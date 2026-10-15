import { useInfiniteQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Skeleton } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { actionLabel } from "./actions";

type AuditEvent = Schemas["AuditEvent"];

const time = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });

function actor(event: AuditEvent): string {
  if (event.actorType === "operator") return "צוות Tempo";
  if (event.actorType === "system") return "המערכת";
  return event.actorDisplayName?.trim() || "—";
}

/** `/o/:slug/audit`: the studio's audit log, newest first (GET /audit-events, keyset pages). */
export function AuditPage() {
  const api = useApi();
  const { organizationId } = useStudio();
  const events = useInfiniteQuery({
    queryKey: ["studio", organizationId, "audit"],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/audit-events", {
          params: { path: { organizationId }, query: { limit: 50, before: pageParam ?? undefined } }
        })
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null
  });
  const rows = events.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>יומן פעולות</h1>
        <p className="tp-muted">מי עשה מה בסטודיו ומתי. היומן לא נמחק ולא משתנה.</p>
      </header>

      {events.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(events.error, "לא הצלחנו לטעון את היומן. נסו שוב.")}
        </Banner>
      ) : !events.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את היומן…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <p className="tp-muted">עוד אין פעולות ביומן.</p>
      ) : (
        <div className="tp-table-wrap">
          <table className="tp-table tp-table--compact">
            <caption className="tp-sr-only">יומן פעולות</caption>
            <thead>
              <tr>
                <th scope="col">מתי</th>
                <th scope="col">מי</th>
                <th scope="col">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => {
                const when = new Date(event.occurredAt);
                return (
                  <tr key={event.id}>
                    <td className="tp-num">
                      {formatDate(toIsoDate(when))} · {time.format(when)}
                    </td>
                    <td>{actor(event)}</td>
                    <td>{actionLabel(event.action)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {events.hasNextPage && (
        <div>
          <Button variant="secondary" loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            פעולות קודמות
          </Button>
        </div>
      )}
    </>
  );
}
