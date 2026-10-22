import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { activeMemberships, useAccount } from "../../account/account";
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationGroup,
  type NotificationPreferences,
  type QuietHours,
  type ReminderSwitches,
} from "../../account/notificationPreferences";
import { errorMessage, hasCode } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  IconButton,
  isTimeWindowValid,
  Radio,
  Skeleton,
  TimeRange,
  Toggle,
  useToast,
} from "../../shared/design-system";
import { DevicePush } from "./DevicePush";
import styles from "./member.module.css";

const groupText: Record<NotificationGroup, { label: string; hint: string }> = {
  bookings: { label: "ההרשמות שלי", hint: "נרשמת, עברת מרשימת ההמתנה, שיעור בוטל או השתנה" },
  reminders: { label: "תזכורות", hint: "לפני שיעור, ולפני שהכרטיסייה או המנוי נגמרים" },
  studio: { label: "הודעות מהסטודיו", hint: "הודעות לרשומים לשיעור ועדכונים מהסטודיו" },
  celebrations: {
    label: "חגיגות: אבני דרך וחברות שהבאת",
    hint: "השיעור ה-10, ה-25, ה-50 ואילך, וכשחברה שהזמנת מגיעה לשיעור הראשון שלה",
  },
};

const reminderText: Record<keyof ReminderSwitches, string> = {
  classTomorrow: "ערב לפני שיעור",
  classSoon: "זמן קצר לפני שיעור",
  passEnding: "לפני שהמנוי או הכרטיסייה פגים",
  entriesLow: "כשנשארות מעט כניסות בכרטיסייה",
};
const reminderKeys = Object.keys(reminderText) as (keyof ReminderSwitches)[];

interface Draft {
  push: Record<NotificationGroup, boolean>;
  reminders: ReminderSwitches;
  /** null: the studio's window. */
  quietHours: QuietHours | null;
}

function draftOf(preferences: NotificationPreferences): Draft {
  const push: Record<NotificationGroup, boolean> = {
    bookings: true,
    reminders: true,
    studio: true,
    celebrations: true,
  };
  for (const group of preferences.groups) push[group.group] = group.channels.push;
  return { push, reminders: preferences.reminders, quietHours: preferences.quietHours ?? null };
}

/**
 * The member's notification preferences in their studio (docs/30 sections 5, 7 and 12): push per group (the inbox
 * is always on), push on this device, the reminders the studio offers, and quiet hours.
 */
export function NotificationsScreen() {
  const me = useAccount();
  const studio = activeMemberships(me)[0];
  const preferences = useNotificationPreferences(studio?.organization.id);
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => (location.key === "default" ? navigate("/profile") : navigate(-1));

  return (
    <main
      className={`tp-page tp-page--tabbar ${styles.screen}`}
      aria-busy={studio && !preferences.data && !preferences.isError}
    >
      <div className={styles.header}>
        <IconButton icon="chevron-right" label="חזרה" onClick={back} />
        <h1 className={styles.title}>העדפות התראות</h1>
      </div>
      {!studio ? (
        <p className="tp-muted">ההגדרות יופיעו אחרי ההצטרפות לסטודיו.</p>
      ) : preferences.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(preferences.error, "לא הצלחנו לטעון את ההעדפות. נסו שוב מאוחר יותר.")}
        </Banner>
      ) : !preferences.data ? (
        <Skeleton height={320} />
      ) : (
        <PreferencesForm
          key={preferences.data.version}
          organizationId={studio.organization.id}
          studioName={studio.organization.displayName}
          preferences={preferences.data}
        />
      )}
    </main>
  );
}

function PreferencesForm({
  organizationId,
  studioName,
  preferences,
}: {
  organizationId: string;
  studioName: string;
  preferences: NotificationPreferences;
}) {
  const saved = draftOf(preferences);
  const [draft, setDraft] = useState(saved);
  const save = useSaveNotificationPreferences(organizationId, preferences.version);
  const toast = useToast();
  const studioWindow = preferences.studioQuietHours;
  const offered = reminderKeys.filter((key) => preferences.studioReminders[key]);
  const ownWindowValid = draft.quietHours === null || isTimeWindowValid(draft.quietHours);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const submit = () =>
    save.mutate(
      {
        groups: (Object.keys(draft.push) as NotificationGroup[]).map((group) => ({
          group,
          channels: { inbox: true, push: draft.push[group] },
        })),
        reminders: draft.reminders,
        quietHours: draft.quietHours,
      },
      {
        onSuccess: () => toast.show({ tone: "success", icon: "check", message: "ההעדפות נשמרו" }),
        onError: (error) =>
          toast.show({
            tone: "danger",
            icon: "info",
            message: hasCode(error, "concurrency.conflict")
              ? "ההעדפות השתנו במכשיר אחר. טענו את העמוד מחדש ונסו שוב."
              : errorMessage(error, "לא הצלחנו לשמור את ההעדפות. נסו שוב."),
          }),
      },
    );

  return (
    <>
      <Card as="section" tone="cream" className={styles.settings} aria-labelledby="channels">
        <h2 id="channels" className={`tp-label tp-muted ${styles.settingsTitle}`}>
          התראות בטלפון
        </h2>
        <p className="tp-caption tp-muted">כל הודעה מגיעה תמיד גם לתיבת ההודעות באפליקציה.</p>
        <DevicePush organizationId={organizationId} />
        {(Object.keys(groupText) as NotificationGroup[]).map((group) => (
          <div key={group}>
            <div className="tp-setting">
              {/* Read once, through the switch: its name is the label, its description the hint. */}
              <span className={styles.settingText} aria-hidden="true">
                <span>{groupText[group].label}</span>
                <span id={`push-hint-${group}`} className="tp-caption">
                  {groupText[group].hint}
                </span>
              </span>
              <Toggle
                label={`${groupText[group].label}: התראה בטלפון`}
                hideLabel
                aria-describedby={`push-hint-${group}`}
                checked={draft.push[group]}
                onChange={(event) => setDraft({ ...draft, push: { ...draft.push, [group]: event.target.checked } })}
              />
            </div>
            <hr className="tp-divider" />
          </div>
        ))}
      </Card>

      {offered.length > 0 && (
        <Card as="section" tone="cream" className={styles.settings} aria-labelledby="reminders">
          <h2 id="reminders" className={`tp-label tp-muted ${styles.settingsTitle}`}>
            תזכורות
          </h2>
          {offered.map((key) => (
            <div key={key}>
              <div className="tp-setting">
                <span className={styles.settingText} aria-hidden="true">
                  <span>{reminderText[key]}</span>
                </span>
                <Toggle
                  label={reminderText[key]}
                  hideLabel
                  checked={draft.reminders[key]}
                  onChange={(event) =>
                    setDraft({ ...draft, reminders: { ...draft.reminders, [key]: event.target.checked } })
                  }
                />
              </div>
              <hr className="tp-divider" />
            </div>
          ))}
        </Card>
      )}

      <Card as="section" tone="cream" className={styles.settings} aria-labelledby="quiet-hours">
        <h2 id="quiet-hours" className={`tp-label tp-muted ${styles.settingsTitle}`}>
          שעות שקטות
        </h2>
        <p className="tp-caption tp-muted">
          בשעות האלה תזכורות והודעות מהסטודיו מחכות לבוקר. הודעה על שיעור שלך שמתחיל בשעות האלה תגיע מיד.
        </p>
        <div role="radiogroup" aria-labelledby="quiet-hours">
          <Radio
            name="quiet-hours"
            label={
              <>
                כמו בסטודיו{" "}
                <span className="tp-ltr" dir="ltr">
                  {studioWindow.startsLocal}–{studioWindow.endsLocal}
                </span>
              </>
            }
            checked={draft.quietHours === null}
            onChange={() => setDraft({ ...draft, quietHours: null })}
          />
          <Radio
            name="quiet-hours"
            label="שעות משלי"
            checked={draft.quietHours !== null}
            onChange={() => setDraft({ ...draft, quietHours: draft.quietHours ?? { ...studioWindow } })}
          />
        </div>
        {draft.quietHours && (
          <TimeRange
            label="שעות שקטות משלי"
            className={styles.quietHours}
            value={draft.quietHours}
            onChange={(quietHours) => setDraft({ ...draft, quietHours })}
          />
        )}
        <p className="tp-caption tp-muted">השעות לפי שעון הסטודיו. ההעדפות נשמרות ב{studioName}.</p>
      </Card>

      <Button block disabled={!dirty || !ownWindowValid} loading={save.isPending} onClick={submit}>
        שמירה
      </Button>
    </>
  );
}
