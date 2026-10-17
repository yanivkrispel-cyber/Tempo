import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  DateInput,
  Dialog,
  Field,
  HealthStatusChip,
  Skeleton,
  useToast,
  YesNoQuestions,
} from "../../shared/design-system";
import { useStudioTimeZone } from "../../shared/studio/timeZone";
import { dateIn, formatDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type PersonDetail = Schemas["PersonDetail"];
type StatusView = Schemas["HealthDeclarationStatusView"];

export const healthKey = (organizationId: string, personId: string) =>
  ["studio", organizationId, "people", personId, "health-declaration"] as const;
/**
 * The answers sit under their own top-level key, never under the status key, so invalidating a person's status can
 * never refetch the answers: each fetch is an audited read.
 */
export const answersKey = (organizationId: string, personId: string) =>
  ["health-answers", organizationId, personId] as const;

/** Dates are the studio's: the server checks an approval against the studio-local day of the signature. */
function useStudioDay() {
  const timeZone = useStudioTimeZone().timeZone ?? "Asia/Jerusalem";
  return (instant: string | Date) => dateIn(instant, timeZone);
}

/**
 * A person's health declaration (docs/31 sections 5 and 13). `people.view` sees the status and its dates, never the
 * answers. `health.view` (the owner by default) opens the answers behind an explicit click, every open is an audited
 * read, and records a medical approval.
 */
export function HealthSection({ person }: { person: PersonDetail }) {
  const api = useApi();
  const studio = useStudio();
  const { organizationId } = studio;
  const [showing, setShowing] = useState(false);
  const [approving, setApproving] = useState(false);
  const status = useQuery({
    queryKey: healthKey(organizationId, person.id),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/health-declaration", {
          params: { path: { organizationId, personId: person.id } },
        }),
      ),
  });
  const canView = studio.can("health.view");
  const declaration = status.data;

  return (
    <Card as="section" aria-labelledby="health" className="tp-stack">
      <h2 id="health">הצהרת בריאות</h2>
      {status.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(status.error, "לא הצלחנו לטעון את מצב ההצהרה. נסו שוב.")}
        </Banner>
      ) : !declaration ? (
        <Skeleton height={56} />
      ) : (
        <>
          <div className="tp-row" style={{ flexWrap: "wrap" }}>
            <HealthStatusChip status={declaration.status} />
          </div>
          <StatusLines declaration={declaration} />
          {canView && declaration.status !== "missing" && (
            <div className="tp-row" style={{ flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" icon="shield" onClick={() => setShowing(true)}>
                הצגת התשובות
              </Button>
              {declaration.status === "needs_medical_approval" && (
                <Button size="sm" icon="check" onClick={() => setApproving(true)}>
                  רישום אישור רפואי
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {showing && <AnswersDialog person={person} onClose={() => setShowing(false)} />}
      {approving && declaration?.signedAt && (
        <ApprovalDialog person={person} signedAt={declaration.signedAt} onClose={() => setApproving(false)} />
      )}
    </Card>
  );
}

function StatusLines({ declaration }: { declaration: StatusView }) {
  const studioDay = useStudioDay();
  const day = (instant: string) => formatDate(studioDay(instant));
  if (declaration.status === "missing") return <p className="tp-muted">עוד לא נחתמה הצהרה בסטודיו.</p>;
  return (
    <dl className="tp-grid" style={{ gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
      {declaration.signedAt && (
        <>
          <dt className="tp-muted">נחתמה</dt>
          <dd className="tp-num">
            {day(declaration.signedAt)}
            {declaration.signerRole === "guardian" && " · על ידי הורה או אפוטרופוס"}
          </dd>
        </>
      )}
      {declaration.expiresAt && (
        <>
          <dt className="tp-muted">{declaration.status === "expired" ? "פגה" : "בתוקף עד"}</dt>
          <dd className="tp-num">{day(declaration.expiresAt)}</dd>
        </>
      )}
      {declaration.medicalApprovalOn && (
        <>
          <dt className="tp-muted">אישור רפואי</dt>
          <dd className="tp-num">{formatDate(declaration.medicalApprovalOn)}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * The answers, read only while the dialog is open: fetched on open (each open is one audited read on the server),
 * never cached (`gcTime` 0, no retry), and gone when it closes.
 */
function AnswersDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const api = useApi();
  const { organizationId } = useStudio();
  const answers = useQuery({
    queryKey: answersKey(organizationId, person.id),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/health-declaration/answers", {
          params: { path: { organizationId, personId: person.id } },
        }),
      ),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const data = answers.data;
  const studioDay = useStudioDay();
  const day = (instant: string) => formatDate(studioDay(instant));
  const byId = Object.fromEntries((data?.answers ?? []).map((answer) => [answer.questionId, answer.answer]));

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          התשובות של <bdi>{person.displayName}</bdi>
        </>
      }
      description="כל פתיחה של התשובות נרשמת ביומן הפעולות, בלי התוכן."
      actions={
        <Button variant="secondary" onClick={onClose}>
          סגירה
        </Button>
      }
    >
      {answers.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(answers.error, "לא הצלחנו לפתוח את התשובות. נסו שוב.")}
        </Banner>
      ) : !data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">פותחים את התשובות…</span>
          <Skeleton height={160} />
        </div>
      ) : (
        <div className="tp-stack">
          <YesNoQuestions label="התשובות" questions={data.form.questions} answers={byId} />
          <dl className="tp-grid" style={{ gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
            <dt className="tp-muted">שם החותם.ת</dt>
            <dd>
              <bdi>{data.signerRole === "guardian" ? data.guardianName : data.signedName}</bdi>
              {data.signerRole === "guardian" && " (הורה או אפוטרופוס)"}
            </dd>
            {data.signerRole === "guardian" && (
              <>
                <dt className="tp-muted">בשם</dt>
                <dd>
                  <bdi>{data.signedName}</bdi>
                </dd>
              </>
            )}
            <dt className="tp-muted">נחתמה</dt>
            <dd className="tp-num">
              {day(data.signedAt)}, גרסת טופס {data.form.version}
            </dd>
          </dl>
        </div>
      )}
    </Dialog>
  );
}

/** "Medical approval received" with its date (H-9): not in the future and not before the declaration was signed. */
function ApprovalDialog({
  person,
  signedAt,
  onClose,
}: {
  person: PersonDetail;
  signedAt: string;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const studioDay = useStudioDay();
  // When the dialog opened; render code does not read the clock.
  const [today] = useState(() => studioDay(new Date()));
  const signedOn = studioDay(signedAt);
  const [approvedOn, setApprovedOn] = useState<string | null>(today);
  const [submitted, setSubmitted] = useState(false);
  const invalid =
    approvedOn === null
      ? `צריך תאריך בין ${formatDate(signedOn)} ל-${formatDate(today)}`
      : approvedOn > today
        ? "התאריך לא יכול להיות בעתיד"
        : approvedOn < signedOn
          ? "התאריך לא יכול להיות לפני החתימה"
          : null;

  const record = useMutation({
    mutationKey: [organizationId, "health.medicalApproval"],
    mutationFn: (date: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/health-declaration/medical-approval", {
          params: { path: { organizationId, personId: person.id } },
          body: { approvedOn: date },
        }),
      ),
    onSuccess: (view) => {
      queryClient.setQueryData(healthKey(organizationId, person.id), view);
      toast.show({ tone: "success", icon: "check", message: "האישור הרפואי נרשם" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid && approvedOn) record.mutate(approvedOn);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="רישום אישור רפואי"
      description={
        <>
          ההצהרה של <bdi>{person.displayName}</bdi> תסומן כחתומה. את המסמך עצמו שומרים מחוץ למערכת.
        </>
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="medical-approval" loading={record.isPending}>
            רישום
          </Button>
        </>
      }
    >
      <form id="medical-approval" onSubmit={submit} noValidate className="tp-stack">
        <Field label="תאריך האישור" required error={submitted ? invalid : undefined}>
          <DateInput value={approvedOn} onChange={setApprovedOn} min={signedOn} max={today} today={today} />
        </Field>
        {record.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(record.error, "לא הצלחנו לרשום את האישור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
