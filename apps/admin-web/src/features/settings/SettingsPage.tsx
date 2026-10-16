import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { meKey } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Field, Input, Select, Skeleton, useToast } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { PlanCard } from "./PlanCard";

type Organization = Schemas["Organization"];

const locales = [
  { value: "he-IL", label: "עברית" },
  { value: "en-US", label: "English" },
];

const timeZones = [{ value: "Asia/Jerusalem", label: "ישראל (Asia/Jerusalem)" }];

/** `/o/:slug/settings`: the studio's name, language and time zone (GET and PATCH /organizations/{id}). */
export function SettingsPage() {
  const api = useApi();
  const { organizationId } = useStudio();
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>הגדרות הסטודיו</h1>
      </header>
      {organization.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(organization.error, "לא הצלחנו לטעון את ההגדרות. נסו שוב.")}
        </Banner>
      ) : !organization.data ? (
        <Skeleton height={260} />
      ) : (
        // Keyed by version: after a save the form starts again from what the API returned.
        <SettingsForm key={organization.data.version} organization={organization.data} />
      )}
      <PlanCard />
    </>
  );
}

function SettingsForm({ organization }: { organization: Organization }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const [displayName, setDisplayName] = useState(organization.displayName);
  const [defaultLocale, setDefaultLocale] = useState(organization.defaultLocale);
  const [timeZone, setTimeZone] = useState(organization.timeZone);
  const [submitted, setSubmitted] = useState(false);
  const editable = studio.can("organization.settings.manage");

  const save = useMutation({
    mutationKey: [organization.id, "settings.updateSettings"],
    mutationFn: (body: Schemas["UpdateOrganizationRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}", {
          params: { path: { organizationId: organization.id }, header: { "If-Match": organization.version } },
          body,
        }),
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["studio", organization.id, "organization"], updated);
      // The name also shows in the console frame and the studio list, which come from GET /me.
      await queryClient.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: "success", icon: "check", message: "ההגדרות נשמרו" });
    },
  });

  const name = displayName.trim();
  const nameError = name.length < 2 ? "שם של 2 תווים לפחות" : name.length > 100 ? "עד 100 תווים" : null;
  const changes: Schemas["UpdateOrganizationRequest"] = {
    ...(name !== organization.displayName ? { displayName: name } : {}),
    ...(defaultLocale !== organization.defaultLocale ? { defaultLocale } : {}),
    ...(timeZone !== organization.timeZone ? { timeZone } : {}),
  };
  const changed = Object.keys(changes).length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!nameError && changed) save.mutate(changes);
  };

  return (
    <Card as="section" aria-label="הגדרות הסטודיו">
      <form className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם הסטודיו" required error={submitted ? nameError : undefined}>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={100}
            disabled={!editable}
          />
        </Field>
        <Field label="שפת ברירת המחדל">
          <Select value={defaultLocale} onChange={(event) => setDefaultLocale(event.target.value)} disabled={!editable}>
            {[
              ...locales,
              ...(locales.some((locale) => locale.value === organization.defaultLocale)
                ? []
                : [{ value: organization.defaultLocale, label: organization.defaultLocale }]),
            ].map((locale) => (
              <option key={locale.value} value={locale.value}>
                {locale.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="אזור זמן">
          <Select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} disabled={!editable}>
            {[
              ...timeZones,
              ...(timeZones.some((zone) => zone.value === organization.timeZone)
                ? []
                : [{ value: organization.timeZone, label: organization.timeZone }]),
            ].map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>
        </Field>
        <dl className="tp-grid" style={{ gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
          <dt className="tp-muted">כתובת</dt>
          <dd>
            <bdi className="tp-ltr">{organization.slug}</bdi>
          </dd>
          <dt className="tp-muted">מדינה ומטבע</dt>
          <dd>
            <bdi className="tp-ltr">
              {organization.countryCode} · {organization.currencyCode}
            </bdi>
          </dd>
          <dt className="tp-muted">נפתח</dt>
          <dd className="tp-num">{formatDate(toIsoDate(new Date(organization.createdAt)))}</dd>
        </dl>
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
        {editable && (
          <div>
            <Button type="submit" loading={save.isPending} disabled={!changed}>
              שמירה
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
