import { consentGranted, useRecordConsent, useStudioProfile, type ConsentChannel, type ConsentPurpose } from "../../account/studioProfile";
import { errorMessage } from "../../api/errors";
import { Skeleton, Toggle, useToast } from "../../shared/design-system";
import styles from "./member.module.css";

interface Choice {
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  label: string;
  hint?: string;
}

// Draft wording until the consent texts are written (docs/27 P-4); see consentTextVersion.
const choices: Choice[] = [
  { purpose: "reminders", channel: "push", label: "התראות בדחיפה", hint: "תזכורות לשיעורים שנרשמת אליהם" },
  { purpose: "reminders", channel: "email", label: "תזכורות במייל" },
  { purpose: "marketing", channel: "email", label: "עדכונים ומבצעים במייל", hint: "לא חובה. אפשר לבטל בכל עת" }
];

/**
 * The notification switches, as the member's consent in their studio (docs/27 section 4.3): each change records
 * one choice; the switch shows the latest. Without a studio there is nothing to consent to yet.
 */
export function ConsentRows({ organizationId, studioName }: { organizationId: string | undefined; studioName: string | undefined }) {
  const profile = useStudioProfile(organizationId);

  if (!organizationId) {
    return <p className="tp-caption tp-muted">ההגדרות יופיעו אחרי ההצטרפות לסטודיו.</p>;
  }
  if (profile.isError) {
    return <p className="tp-caption tp-muted">{errorMessage(profile.error, "לא הצלחנו לטעון את ההגדרות.")}</p>;
  }
  if (!profile.data) {
    return <Skeleton height={96} />;
  }

  return (
    <>
      {choices.map((choice) => (
        <ConsentRow key={`${choice.purpose}-${choice.channel}`} organizationId={organizationId} choice={choice} granted={consentGranted(profile.data, choice.purpose, choice.channel)} />
      ))}
      <p className="tp-caption tp-muted">ההגדרות נשמרות ב{studioName}.</p>
      <hr className="tp-divider" />
    </>
  );
}

function ConsentRow({ organizationId, choice, granted }: { organizationId: string; choice: Choice; granted: boolean }) {
  const record = useRecordConsent(organizationId);
  const toast = useToast();
  // While the choice is on its way, the switch already shows it.
  const checked = record.isPending ? record.variables.granted : granted;

  return (
    <>
      <div className="tp-setting">
        <span className={styles.settingText} aria-hidden="true">
          <span>{choice.label}</span>
          {choice.hint && <span className="tp-caption">{choice.hint}</span>}
        </span>
        <Toggle
          label={choice.label}
          hideLabel
          checked={checked}
          disabled={record.isPending}
          onChange={(event) =>
            record.mutate(
              { purpose: choice.purpose, channel: choice.channel, granted: event.target.checked },
              { onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error, "לא הצלחנו לשמור את הבחירה. נסו שוב.") }) }
            )
          }
        />
      </div>
      <hr className="tp-divider" />
    </>
  );
}
