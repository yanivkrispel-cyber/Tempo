import { useMutation } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { Banner, Button, Dialog, Field, Textarea, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import type { Session } from "./queries";

type SessionMessage = Schemas["SessionMessage"];

/** The contract's limit (`SendSessionMessageRequest.text`). */
const maxLength = 500;

/**
 * A short text to everyone booked or waiting on one class (docs/29 section 16.2): it reaches each of them in the
 * app's inbox. No push, SMS or email yet (docs/30), and the audit log keeps only that a message went out.
 */
export function SessionMessageDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = text.trim();
  const fieldError = touched && trimmed === "" ? "כתבו מה תרצו לספר לרשומים." : undefined;

  const send = useMutation({
    mutationKey: [organizationId, "schedule.message"],
    mutationFn: (body: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/sessions/{sessionId}/messages", {
          params: { path: { organizationId, sessionId: session.id } },
          body: { text: body },
        }),
      ),
    onSuccess: (sent: SessionMessage) => {
      toast.show({
        tone: "success",
        icon: "check",
        message:
          sent.recipients === 0
            ? "אין כרגע רשומים או ממתינים לשיעור, ולכן ההודעה לא הגיעה לאף אחד."
            : sent.recipients === 1
              ? "ההודעה נשלחה לאדם אחד."
              : `ההודעה נשלחה ל־${sent.recipients} אנשים.`,
      });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (trimmed) send.mutate(trimmed);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="הודעה לרשומים"
      description="ההודעה מגיעה להתראות באפליקציה של כל מי שרשום לשיעור או ממתין לו. עד 5 הודעות לשיעור בשעה."
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            ביטול
          </Button>
          <Button type="submit" form="session-message" icon="mail" loading={send.isPending}>
            שליחה
          </Button>
        </>
      }
    >
      <form id="session-message" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="ההודעה" required help={`${text.length} מתוך ${maxLength} תווים`} error={fieldError}>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={maxLength}
            rows={4}
            dir="auto"
            placeholder="למשל: השיעור עובר לאולם הגדול"
          />
        </Field>
        {send.isError && (
          <Banner tone="danger" icon="info">
            {hasCode(send.error, "booking.closed")
              ? "השיעור בוטל או הסתיים לפני יותר מיממה, ולכן אי אפשר לשלוח אליו הודעה."
              : errorMessage(send.error, "לא הצלחנו לשלוח. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
