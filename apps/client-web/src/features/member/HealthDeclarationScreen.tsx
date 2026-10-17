import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage, hasCode } from "../../api/errors";
import { activeMemberships, useAccount } from "../../account/account";
import {
  allAnswered,
  Banner,
  Button,
  Card,
  emptySignature,
  HealthStatusChip,
  IconButton,
  isSignatureComplete,
  Signature,
  Skeleton,
  useToast,
  YesNoQuestions,
  type SignatureValue,
  type YesNoAnswers,
} from "../../shared/design-system";
import { formatDate } from "../../shared/utilities/dates";
import {
  useMyHealthDeclaration,
  useSignHealthDeclaration,
  type HealthDeclarationStatusView,
  type HealthForm,
  type MyHealthDeclaration,
} from "./health";
import styles from "./member.module.css";
import { useStudioTimeZone } from "./studio";
import { studioDate } from "./studioTime";

/** The draft wording until the consent texts are approved (P-4). */
const confirmation = "קראתי את השאלות, התשובות נכונות, ואעדכן את הסטודיו אם משהו ישתנה.";

/**
 * The member's health declaration in their studio (docs/31 section 13): the status and what it means, and the form
 * to sign, renew when it expired, or sign again.
 */
export function HealthDeclarationScreen() {
  const studio = activeMemberships(useAccount())[0];
  const declaration = useMyHealthDeclaration(studio?.organization.id);
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => (location.key === "default" ? navigate("/profile") : navigate(-1));

  return (
    <main
      className={`tp-page tp-page--tabbar ${styles.screen}`}
      aria-busy={studio && !declaration.data && !declaration.isError}
    >
      <div className={styles.header}>
        <IconButton icon="chevron-right" label="חזרה" onClick={back} />
        <h1 className={styles.title}>הצהרת בריאות</h1>
      </div>
      {!studio ? (
        <p className="tp-muted">ההצהרה תופיע אחרי ההצטרפות לסטודיו.</p>
      ) : declaration.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(declaration.error, "לא הצלחנו לטעון את ההצהרה. נסו שוב מאוחר יותר.")}
        </Banner>
      ) : !declaration.data ? (
        <Skeleton height={320} />
      ) : (
        <Declaration
          organizationId={studio.organization.id}
          studioName={studio.organization.displayName}
          mine={declaration.data}
        />
      )}
    </main>
  );
}

function Declaration({
  organizationId,
  studioName,
  mine,
}: {
  organizationId: string;
  studioName: string;
  mine: MyHealthDeclaration;
}) {
  const { declaration, form, required } = mine;
  const timeZone = useStudioTimeZone(organizationId);
  const mustSign = declaration.status === "missing" || declaration.status === "expired";
  const [signing, setSigning] = useState(false);
  // The platform published a new form while the member was filling the old one: the new one starts over.
  const [stale, setStale] = useState(false);
  const toast = useToast();

  return (
    <>
      <Card as="section" small aria-labelledby="health-status" className={styles.healthStatus}>
        <h2 id="health-status" className="tp-label tp-muted">
          המצב שלך ב<bdi>{studioName}</bdi>
        </h2>
        <HealthStatusChip status={declaration.status} />
        <StatusText declaration={declaration} required={required} timeZone={timeZone} />
        {!mustSign && !signing && (
          <Button variant="secondary" onClick={() => setSigning(true)}>
            עדכון ההצהרה
          </Button>
        )}
      </Card>
      {stale && (mustSign || signing) && (
        <Banner tone="info" icon="info">
          הטופס עודכן בינתיים. עברו על השאלות שוב וחתמו.
        </Banner>
      )}
      {(mustSign || signing) && (
        <SignForm
          // A new form version starts the form over.
          key={form.version}
          organizationId={organizationId}
          form={form}
          renew={declaration.status !== "missing"}
          onCancel={mustSign ? undefined : () => setSigning(false)}
          onStale={() => setStale(true)}
          onSigned={(next) => {
            setSigning(false);
            setStale(false);
            toast.show({
              tone: "success",
              icon: "check",
              message:
                next.declaration.status === "needs_medical_approval"
                  ? "ההצהרה נשמרה. לפני השיעור הראשון צריך להביא אישור רפואי."
                  : "ההצהרה נחתמה. תודה!",
            });
          }}
        />
      )}
    </>
  );
}

function StatusText({
  declaration,
  required,
  timeZone,
}: {
  declaration: HealthDeclarationStatusView;
  required: boolean;
  timeZone: string;
}) {
  const date = (instant: string | null | undefined) => (instant ? formatDate(studioDate(instant, timeZone)) : "");
  const gate = required ? " עד אז אי אפשר להירשם לשיעורים." : "";
  switch (declaration.status) {
    case "missing":
      return <p>הסטודיו מבקש למלא הצהרת בריאות לפני השיעור הראשון.{gate}</p>;
    case "expired":
      return (
        <p>
          ההצהרה שחתמת עליה פגה ב-{date(declaration.expiresAt)}. היא בתוקף שנה, ולכן צריך לחתום עליה שוב.{gate}
        </p>
      );
    case "needs_medical_approval":
      return (
        <p>
          ענית &quot;כן&quot; על לפחות אחת מהשאלות. לפני שמתחילים להתאמן צריך להביא לסטודיו אישור רפואי. כשהסטודיו יקבל
          אותו הוא יעדכן כאן, וההצהרה תסומן כחתומה.{gate}
        </p>
      );
    case "signed":
      return (
        <p>
          חתמת ב-{date(declaration.signedAt)}. ההצהרה בתוקף עד {date(declaration.expiresAt)}.
          {declaration.medicalApprovalOn && <> האישור הרפואי התקבל ב-{formatDate(declaration.medicalApprovalOn)}.</>}
        </p>
      );
  }
}

function SignForm({
  organizationId,
  form,
  renew,
  onCancel,
  onStale,
  onSigned,
}: {
  organizationId: string;
  form: HealthForm;
  renew: boolean;
  onCancel?: () => void;
  onStale: () => void;
  onSigned: (declaration: MyHealthDeclaration) => void;
}) {
  const [answers, setAnswers] = useState<YesNoAnswers>({});
  const [signature, setSignature] = useState<SignatureValue>(emptySignature);
  const [submitted, setSubmitted] = useState(false);
  const sign = useSignHealthDeclaration(organizationId);
  const complete = allAnswered(form.questions, answers) && isSignatureComplete(signature);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!complete) return;
    sign.mutate(
      { form, answers, signature },
      {
        onSuccess: onSigned,
        onError: (error) => {
          if (hasCode(error, "health.form_version_stale")) onStale();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className={styles.healthForm} aria-labelledby="health-form-title">
      <h2 id="health-form-title" className={styles.sectionTitle}>
        {renew ? "חתימה מחדש" : "מילוי ההצהרה"}
      </h2>
      <p className="tp-caption tp-muted">
        התשובות מוצפנות. רק בעלי הסטודיו יכולים לפתוח אותן, וכל פתיחה נרשמת. אם עניתם &quot;כן&quot; על שאלה, הסטודיו
        יבקש אישור רפואי.
      </p>
      <YesNoQuestions
        label="שאלות ההצהרה"
        questions={form.questions}
        answers={answers}
        showMissing={submitted}
        disabled={sign.isPending}
        onChange={(id, answer) => setAnswers((current) => ({ ...current, [id]: answer }))}
      />
      <Signature
        value={signature}
        onChange={setSignature}
        confirmation={confirmation}
        showErrors={submitted}
        disabled={sign.isPending}
      />
      {submitted && !complete && (
        <Banner tone="warning" icon="info">
          חסרים פרטים בטופס. הם מסומנים למעלה.
        </Banner>
      )}
      {sign.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(sign.error, "החתימה לא נשמרה. נסו שוב.")}
        </Banner>
      )}
      <div className={styles.healthActions}>
        <Button type="submit" size="lg" block loading={sign.isPending}>
          חתימה ושליחה
        </Button>
        {onCancel && (
          <Button variant="ghost" block onClick={onCancel} disabled={sign.isPending}>
            ביטול
          </Button>
        )}
      </div>
    </form>
  );
}
