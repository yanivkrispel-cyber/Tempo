import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import {
  Banner,
  Button,
  Dialog,
  Field,
  Input,
  Skeleton,
  Textarea,
  TemplatePreview,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";

type Allowance = Schemas["AnnouncementAllowance"];
type Announcement = Schemas["Announcement"];

/** The contract's limits (`AnnouncementInput`). */
const subjectMax = 80;
const bodyMax = 1000;

const people = (count: number) => (count === 1 ? "מתאמן פעיל אחד" : `${count} מתאמנים פעילים`);

const allowanceKey = (organizationId: string) => ["studio", organizationId, "announcements"];

/**
 * A studio announcement to every active member (docs/30 section 7): one inbox item each, through their preferences
 * and quiet hours. At most `dailyLimit` a day and `maxRecipients` people, both read from the API before sending.
 */
export function AnnouncementDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [touched, setTouched] = useState(false);
  const draft = { subject: subject.trim(), body: body.trim() };

  const allowance = useQuery({
    queryKey: allowanceKey(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/announcements", {
          params: { path: { organizationId } },
        }),
      ),
  });

  const send = useMutation({
    mutationKey: [organizationId, "announcement.send"],
    mutationFn: (input: Schemas["AnnouncementInput"]) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/announcements", {
          params: { path: { organizationId } },
          body: input,
        }),
      ),
    onSuccess: (sent: Announcement) => {
      toast.show({
        tone: "success",
        icon: "check",
        message:
          sent.recipients === 0
            ? "אין כרגע מתאמנים פעילים, ולכן ההודעה לא הגיעה לאף אחד."
            : `ההודעה נשלחה ל־${people(sent.recipients)}.`,
      });
      onClose();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: allowanceKey(organizationId) }),
  });

  const blocked = allowance.data ? blockedReason(allowance.data) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (draft.subject && draft.body && !blocked) send.mutate(draft);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="הודעה לכל הסטודיו"
      description="ההודעה מגיעה לתיבת ההודעות של כל המתאמנים הפעילים, ובפוש לפי ההעדפות ושעות השקט של כל אחד."
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            ביטול
          </Button>
          <Button
            type="submit"
            form="announcement"
            icon="mail"
            loading={send.isPending}
            disabled={!allowance.data || blocked !== null}
          >
            {allowance.data && !blocked ? `שליחה ל־${people(allowance.data.recipients)}` : "שליחה"}
          </Button>
        </>
      }
    >
      <form id="announcement" className="tp-stack" onSubmit={submit} noValidate>
        {allowance.isError ? (
          <Banner tone="danger" icon="info">
            {errorMessage(allowance.error, "לא הצלחנו לבדוק למי ההודעה תגיע. נסו שוב.")}
          </Banner>
        ) : !allowance.data ? (
          <Skeleton height={20} />
        ) : blocked ? (
          <Banner tone="warning" icon="info">
            {blocked}
          </Banner>
        ) : (
          <p className="tp-caption tp-muted" data-testid="announcement-allowance">
            ההודעה תגיע ל־{people(allowance.data.recipients)}. נשלחו היום {allowance.data.sentToday} מתוך{" "}
            {allowance.data.dailyLimit} הודעות.
          </p>
        )}
        <Field
          label="נושא"
          required
          help={`${subject.length} מתוך ${subjectMax} תווים`}
          error={touched && !draft.subject ? "כתבו נושא קצר." : undefined}
        >
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={subjectMax}
            dir="auto"
            placeholder="למשל: הסטודיו סגור בחג"
          />
        </Field>
        <Field
          label="ההודעה"
          required
          help={`${body.length} מתוך ${bodyMax} תווים. **מודגש**, [קישור](https://...) ושורה ריקה בין פסקאות.`}
          error={touched && !draft.body ? "כתבו מה תרצו לספר למתאמנים." : undefined}
        >
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={bodyMax}
            rows={5}
            dir="auto"
          />
        </Field>
        {(draft.subject || draft.body) && <TemplatePreview channel="inbox" subject={draft.subject} body={draft.body} />}
        {send.isError && (
          <Banner tone="danger" icon="info">
            {sendError(send.error)}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

/** Why the studio cannot send now, from the allowance the API reports. */
function blockedReason(allowance: Allowance): string | null {
  if (allowance.sentToday >= allowance.dailyLimit)
    return `כבר נשלחו היום ${allowance.dailyLimit} הודעות לכל הסטודיו. אפשר לשלוח שוב מחר.`;
  if (allowance.recipients > allowance.maxRecipients)
    return `לסטודיו ${allowance.recipients} מתאמנים פעילים, ואפשר לשלוח הודעה כזו לעד ${allowance.maxRecipients}.`;
  return null;
}

function sendError(error: unknown): string {
  if (hasCode(error, "announcement.daily_limit")) return "כבר נשלחו היום כל ההודעות האפשריות. אפשר לשלוח שוב מחר.";
  if (hasCode(error, "announcement.too_many_recipients"))
    return "יש בסטודיו יותר מתאמנים פעילים ממה שהודעה כזו יכולה להגיע אליהם, ולכן היא לא נשלחה.";
  return errorMessage(error, "לא הצלחנו לשלוח. נסו שוב.");
}
