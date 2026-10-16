import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Card, Chip, Icon, Skeleton } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { inCatalogOrder, permissionLabel } from "./catalog";

/** `/o/:slug/roles`: the studio's roles and what each may do (GET /roles, docs/27 section 3.2). */
export function RolesPage() {
  const api = useApi();
  const { organizationId, membership } = useStudio();
  const roles = useQuery({
    queryKey: ["studio", organizationId, "roles"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/roles", { params: { path: { organizationId } } })),
  });
  const mine = new Set((membership.roles ?? []).map((role) => role.id));

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>תפקידים</h1>
        <p className="tp-muted">בכל סטודיו יש ארבעה תפקידים קבועים. כל חבר מקבל אחד מהם, והוא קובע מה מותר לו.</p>
      </header>

      {roles.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(roles.error, "לא הצלחנו לטעון את התפקידים. נסו שוב.")}
        </Banner>
      ) : !roles.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את התפקידים…</span>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      ) : (
        <div
          className="tp-grid"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "var(--space-5)" }}
        >
          {roles.data.items.map((role) => (
            <Card as="section" key={role.id} aria-labelledby={`role-${role.key}`} className="tp-stack">
              <div className="tp-row" style={{ justifyContent: "space-between" }}>
                <h2 id={`role-${role.key}`}>{role.displayName}</h2>
                {mine.has(role.id) && <Chip tone="brand">התפקיד שלך</Chip>}
              </div>
              <ul
                className="tp-stack"
                style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}
                aria-label={`ההרשאות של ${role.displayName}`}
              >
                {inCatalogOrder(role.permissions).map((key) => (
                  <li key={key} className="tp-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                    <Icon name="check" />
                    <span>{permissionLabel(key)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
