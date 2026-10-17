import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Card, Chip, Skeleton } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { groupLabels, kindLabel, type NotificationGroup } from "./templates";

type TemplateRow = Schemas["NotificationTemplateList"]["items"][number];

export const templatesKey = (organizationId: string) => ["studio", organizationId, "notification-templates"];

/**
 * The words of each notification, by group (docs/30 step 7): which ones the studio has reworded, and a link to edit
 * each. Only for `organization.settings.manage`, like the endpoint.
 */
export function TemplatesCard() {
  const api = useApi();
  const studio = useStudio();
  const allowed = studio.can("organization.settings.manage");
  const templates = useQuery({
    queryKey: templatesKey(studio.organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/notification-templates", {
          params: { path: { organizationId: studio.organizationId } },
        }),
      ),
    enabled: allowed,
  });
  if (!allowed) return null;

  const groups = (Object.keys(groupLabels) as NotificationGroup[])
    .map((group) => ({ group, rows: (templates.data?.items ?? []).filter((row) => row.group === group) }))
    .filter(({ rows }) => rows.length > 0);

  return (
    <Card as="section" aria-labelledby="templates-title">
      <div className="tp-stack">
        <h2 id="templates-title">נוסחי ההודעות</h2>
        <p className="tp-caption tp-muted">
          המילים שהמתאמנים מקבלים בתיבת ההודעות ובהתראה בטלפון. בלי שינוי, נשלח הנוסח של Tempo.
        </p>
        {templates.isError ? (
          <Banner tone="danger" icon="info">
            {errorMessage(templates.error, "לא הצלחנו לטעון את נוסחי ההודעות. נסו שוב.")}
          </Banner>
        ) : !templates.data ? (
          <Skeleton height={200} />
        ) : (
          groups.map(({ group, rows }) => (
            <section key={group} className="tp-stack" style={{ gap: 4 }} aria-labelledby={`templates-${group}`}>
              <h3 id={`templates-${group}`} className="tp-label tp-muted">
                {groupLabels[group]}
              </h3>
              <ul className="tp-stack" style={{ gap: 0, listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((row) => (
                  <TemplateListRow key={row.kind} row={row} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Card>
  );
}

function TemplateListRow({ row }: { row: TemplateRow }) {
  const customized = row.customized.length > 0;
  return (
    <li className="tp-setting">
      <Link to={`templates/${encodeURIComponent(row.kind)}`} className="tp-hit">
        {kindLabel(row.kind)}
      </Link>
      <Chip tone={customized ? "brand" : "neutral"}>
        {!customized
          ? "נוסח Tempo"
          : row.customized.length === 2
            ? "נוסח של הסטודיו"
            : row.customized[0] === "inbox"
              ? "נוסח של הסטודיו בתיבה"
              : "נוסח של הסטודיו בפוש"}
      </Chip>
    </li>
  );
}
