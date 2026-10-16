import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  Field,
  isTimeWindowValid,
  Select,
  Skeleton,
  TimeRange,
  Toggle,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";

type NotificationSettings = Schemas["NotificationSettings"];
type ReminderTiming = Schemas["ReminderTiming"];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** The reminder job ticks hourly from 07:00 to 21:00 studio time (#199), so the evening reminder goes on the hour. */
const sendTimes = (current: string) => {
  const hours = range(12, 21).map((hour) => `${String(hour).padStart(2, "0")}:00`);
  return hours.includes(current) ? hours : [...hours, current].sort();
};

/**
 * The studio's quiet hours and reminder timing (docs/30 D-4, D-5). Everyone with `organization.view` sees them;
 * `organization.settings.manage` changes them.
 */
export function NotificationSettingsCard() {
  const api = useApi();
  const { organizationId } = useStudio();
  const settings = useQuery({
    queryKey: ["studio", organizationId, "notification-settings"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/notification-settings", {
          params: { path: { organizationId } },
        }),
      ),
  });

  return settings.isError ? (
    <Banner tone="danger" icon="info">
      {errorMessage(settings.error, "לא הצלחנו לטעון את הגדרות ההתראות. נסו שוב.")}
    </Banner>
  ) : !settings.data ? (
    <Skeleton height={320} />
  ) : (
    // Keyed by version: after a save the form starts again from what the API returned.
    <NotificationSettingsForm key={settings.data.version} settings={settings.data} />
  );
}

function NotificationSettingsForm({ settings }: { settings: NotificationSettings }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const editable = studio.can("organization.settings.manage");
  const [quietHours, setQuietHours] = useState(settings.quietHours);
  const [reminders, setReminders] = useState(settings.reminders);

  const save = useMutation({
    mutationKey: [studio.organizationId, "notifications.settings.update"],
    mutationFn: (body: Schemas["NotificationSettingsInput"]) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/notification-settings", {
          params: { path: { organizationId: studio.organizationId }, header: { "If-Match": settings.version } },
          body,
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(["studio", studio.organizationId, "notification-settings"], updated);
      toast.show({ tone: "success", icon: "check", message: "הגדרות ההתראות נשמרו" });
    },
  });

  const quietValid = isTimeWindowValid(quietHours);
  const changed =
    JSON.stringify({ quietHours, reminders }) !==
    JSON.stringify({ quietHours: settings.quietHours, reminders: settings.reminders });

  const setReminder = <K extends keyof ReminderTiming>(key: K, value: Partial<ReminderTiming[K]>) =>
    setReminders({ ...reminders, [key]: { ...reminders[key], ...value } });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (quietValid && changed) save.mutate({ quietHours, reminders });
  };

  const numberSelect = (
    label: string,
    value: number,
    options: number[],
    unit: (n: number) => string,
    onChange: (n: number) => void,
    enabled: boolean,
  ) => (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={!editable || !enabled}>
        {options.map((option) => (
          <option key={option} value={option}>
            {unit(option)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Card as="section" aria-label="התראות ותזכורות">
      <form className="tp-stack" onSubmit={submit} noValidate>
        <h2>התראות ותזכורות</h2>

        <fieldset className="tp-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="tp-label">שעות שקטות</legend>
          <p className="tp-caption tp-muted">
            בשעות האלה תזכורות והודעות מהסטודיו מחכות לסוף החלון. הודעה על שיעור שמתחיל בתוך החלון יוצאת מיד. כל מתאמן
            יכול לקבוע שעות משלו. השעות לפי אזור הזמן של הסטודיו (<bdi className="tp-ltr">{settings.timeZone}</bdi>).
          </p>
          <TimeRange label="שעות שקטות" value={quietHours} disabled={!editable} onChange={setQuietHours} />
        </fieldset>

        <fieldset className="tp-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="tp-label">תזכורות למתאמנים</legend>
          <p className="tp-caption tp-muted">
            תזכורת שכבויה כאן לא נשלחת לאף אחד. תזכורת פעילה נשלחת לכל מי שלא כיבה אותה אצלו.
          </p>

          <Toggle
            label="ערב לפני שיעור"
            checked={reminders.classTomorrow.enabled}
            disabled={!editable}
            onChange={(event) => setReminder("classTomorrow", { enabled: event.target.checked })}
          />
          <Field label="שעת השליחה" help="התזכורות יוצאות בשעות עגולות, בין 12:00 ל־21:00.">
            <Select
              value={reminders.classTomorrow.sendAtLocal}
              onChange={(event) => setReminder("classTomorrow", { sendAtLocal: event.target.value })}
              disabled={!editable || !reminders.classTomorrow.enabled}
            >
              {sendTimes(reminders.classTomorrow.sendAtLocal).map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </Select>
          </Field>

          <Toggle
            label="זמן קצר לפני שיעור"
            checked={reminders.classSoon.enabled}
            disabled={!editable}
            onChange={(event) => setReminder("classSoon", { enabled: event.target.checked })}
          />
          {numberSelect(
            "כמה זמן לפני",
            reminders.classSoon.hoursBefore,
            range(1, 12),
            (n) => (n === 1 ? "שעה" : n === 2 ? "שעתיים" : `${n} שעות`),
            (hoursBefore) => setReminder("classSoon", { hoursBefore }),
            reminders.classSoon.enabled,
          )}
          <p className="tp-caption tp-muted">
            התזכורות יוצאות בין 07:00 ל־21:00, ולכן שיעור שמתחיל לפני 07:00 מקבל רק את התזכורת של הערב שלפני.
          </p>

          <Toggle
            label="לפני שהמנוי או הכרטיסייה פגים"
            checked={reminders.passEnding.enabled}
            disabled={!editable}
            onChange={(event) => setReminder("passEnding", { enabled: event.target.checked })}
          />
          {numberSelect(
            "כמה ימים לפני",
            reminders.passEnding.daysBefore,
            range(1, 30),
            (n) => (n === 1 ? "יום" : n === 2 ? "יומיים" : `${n} ימים`),
            (daysBefore) => setReminder("passEnding", { daysBefore }),
            reminders.passEnding.enabled,
          )}

          <Toggle
            label="כשנשארות מעט כניסות בכרטיסייה"
            checked={reminders.entriesLow.enabled}
            disabled={!editable}
            onChange={(event) => setReminder("entriesLow", { enabled: event.target.checked })}
          />
          {numberSelect(
            "כשנשארות",
            reminders.entriesLow.entriesLeft,
            range(1, 5),
            (n) => (n === 1 ? "כניסה אחת" : `${n} כניסות`),
            (entriesLeft) => setReminder("entriesLow", { entriesLeft }),
            reminders.entriesLow.enabled,
          )}
        </fieldset>

        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
        {editable && (
          <div>
            <Button type="submit" loading={save.isPending} disabled={!changed || !quietValid}>
              שמירת הגדרות ההתראות
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
