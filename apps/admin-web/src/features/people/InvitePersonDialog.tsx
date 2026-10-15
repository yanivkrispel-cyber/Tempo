import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { CopyLink } from "../../shared/CopyLink";
import { Banner, Button, Dialog, Field, Input } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type PersonDetail = Schemas["PersonDetail"];

const day = (iso: string) => formatDate(toIsoDate(new Date(iso)));

/**
 * Invites a recorded person, usually a walk-in, to the app as a client (docs/27 section 4.5). Accepting the
 * invitation links the new login to this record instead of creating a second one. A new email becomes one of the
 * person's contacts. The link is shown once.
 */
export function InvitePersonDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const [email, setEmail] = useState(
    person.primaryEmail ?? person.contactPoints.find((contact) => contact.type === "email")?.value ?? "",
  );
  const [submitted, setSubmitted] = useState(false);
  const invite = useMutation({
    mutationKey: [organizationId, "people.invite"],
    mutationFn: (address: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/invite", {
          params: { path: { organizationId, personId: person.id } },
          body: { email: address },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "person", person.id] }),
        queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] }),
        queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "invitations"] }),
      ]),
  });

  const address = email.trim();
  const malformed = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  const invalid = malformed || hasCode(invite.error, "contact_point.invalid_email") ? "כתובת מייל לא תקינה" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!malformed) invite.mutate(address);
  };

  if (invite.data) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="ההזמנה מוכנה"
        description={`שלחו את הקישור ל־${invite.data.email}. הוא בתוקף עד ${day(invite.data.expiresAt)}.`}
        actions={<Button onClick={onClose}>סיום</Button>}
      >
        <CopyLink link={invite.data.link} label="קישור ההזמנה" />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="הזמנה לאפליקציה"
      description={`Tempo עוד לא שולחת מיילים: אחרי היצירה תקבלו קישור לשלוח ל־${person.displayName}. מי שמצטרף בקישור מתחבר לרשומה הזו.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="invite-person" loading={invite.isPending}>
            יצירת הזמנה
          </Button>
        </>
      }
    >
      <form id="invite-person" className="tp-stack" onSubmit={submit} noValidate>
        <Field
          label="מייל"
          required
          help="הכתובת שאיתה יתחברו. כתובת חדשה תתווסף לפרטי הקשר."
          error={submitted ? invalid : undefined}
        >
          <Input
            type="email"
            dir="ltr"
            className="tp-ltr"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              invite.reset();
            }}
            autoComplete="off"
          />
        </Field>
        {invite.isError && !hasCode(invite.error, "contact_point.invalid_email") && (
          <Banner tone="danger" icon="info">
            {errorMessage(invite.error, "לא הצלחנו ליצור את ההזמנה. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
