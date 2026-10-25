import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { meKey } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Field, Input, Select, Skeleton, useToast } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { BookingPolicyCard } from "./BookingPolicyCard";
import { BrandCard } from "./BrandCard";
import { InstallAppCard } from "./InstallAppCard";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import { PlanCard } from "./PlanCard";
import { PublicPageCard } from "./PublicPageCard";
import { TagsCard } from "./TagsCard";
import { TemplatesCard } from "./TemplatesCard";
import styles from "./settings.module.css";

type Organization = Schemas["Organization"];

const locales = [
  { value: "he-IL", label: "עברית" },
  { value: "en-US", label: "English" },
];

const timeZones = [{ value: "Asia/Jerusalem", label: "ישראל (Asia/Jerusalem)" }];

/**
 * `/o/:slug/settings`: the studio's name, language and time zone (GET and PATCH /organizations/{id}), its brand for
 * members (WL3), its public page (MO2), the health gate of its booking policy, its notification settings, the words of its notifications, its tags and its plan.
 */
export function SettingsPage() {
  const api = useApi();
  const studio = useStudio();
  const { organizationId } = studio;
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });

  const sections: { id: string; label: string; card: ReactNode }[] = [
    {
      id: "settings-studio",
      label: "פרטי הסטודיו",
      card: organization.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(organization.error, "לא הצלחנו לטעון את ההגדרות. נסו שוב.")}
        </Banner>
      ) : !organization.data ? (
        <Skeleton height={260} />
      ) : (
        // Keyed by version: after a save the form starts again from what the API returned.
        <SettingsForm key={organization.data.version} organization={organization.data} />
      ),
    },
    { id: "settings-brand", label: "מיתוג", card: <BrandCard /> },
    { id: "settings-public", label: "עמוד ציבורי", card: <PublicPageCard /> },
    { id: "settings-booking", label: "הרשמה לשיעורים", card: <BookingPolicyCard /> },
    { id: "settings-notifications", label: "התראות ותזכורות", card: <NotificationSettingsCard /> },
    { id: "settings-templates", label: "נוסחי ההודעות", card: <TemplatesCard /> },
    ...(studio.can("people.tags.manage") ? [{ id: "settings-tags", label: "תגיות", card: <TagsCard /> }] : []),
    { id: "settings-plan", label: "המנוי ל־Tempo", card: <PlanCard /> },
  ];
  const current = useCurrentSection(sections.map((section) => section.id));

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>הגדרות הסטודיו</h1>
      </header>
      {/* On a computer an index of the sections beside them; on a phone the wrappers are `display: contents` (#488). */}
      <div className={styles.layout}>
        <nav className={styles.index} aria-label="חלקי ההגדרות">
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} aria-current={current === section.id ? "location" : undefined}>
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.sections}>
          {sections.map((section) => (
            <div key={section.id} id={section.id} className={styles.section}>
              {section.card}
            </div>
          ))}
          {/* Only where the browser offers to install, so it has no place in the index. */}
          <InstallAppCard />
        </div>
      </div>
    </>
  );
}

/** The section at the top of the screen, for the index to mark; none where the browser cannot tell. */
function useCurrentSection(ids: readonly string[]): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(ids[0]);
  const key = ids.join(" ");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
        const first = key.split(" ").find((id) => seen.get(id));
        if (first) setCurrent(first);
      },
      // A section counts once it reaches the upper third of the screen.
      { rootMargin: "0px 0px -66% 0px" },
    );
    for (const id of key.split(" ")) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
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
