import { useState, type FormEvent } from "react";
import { useUpdateStudioProfile, type PersonDetail } from "../../account/studioProfile";
import { errorMessage } from "../../api/errors";
import { Banner, Button, DateInput, Dialog, Field, Input, useToast } from "../../shared/design-system";
import { todayIso, type IsoDate } from "../../shared/utilities/dates";

export interface MyDetailsDialogProps {
  organizationId: string;
  studioName: string;
  profile: PersonDetail;
  onClose: () => void;
}

/** The member's own record in their studio (PATCH /me/profile): first and last name and birth date. */
export function MyDetailsDialog({ organizationId, studioName, profile, onClose }: MyDetailsDialogProps) {
  const update = useUpdateStudioProfile(organizationId, profile.version);
  const toast = useToast();
  const [givenName, setGivenName] = useState(profile.givenName ?? "");
  const [familyName, setFamilyName] = useState(profile.familyName ?? "");
  const [birthDate, setBirthDate] = useState<IsoDate | null>(profile.birthDate ?? null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(
      // An emptied field clears it, as the contract allows.
      { givenName: givenName.trim() || null, familyName: familyName.trim() || null, birthDate },
      {
        onSuccess: () => {
          toast.show({ tone: "success", icon: "check", message: "הפרטים נשמרו" });
          onClose();
        }
      }
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="הפרטים שלי"
      description={`מה ש${studioName} רואה עליך. לא חובה למלא.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="my-details" loading={update.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="my-details" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם פרטי">
          <Input value={givenName} onChange={(event) => setGivenName(event.target.value)} maxLength={100} autoComplete="given-name" />
        </Field>
        <Field label="שם משפחה">
          <Input value={familyName} onChange={(event) => setFamilyName(event.target.value)} maxLength={100} autoComplete="family-name" />
        </Field>
        <Field label="תאריך לידה">
          <DateInput value={birthDate} onChange={setBirthDate} max={todayIso()} />
        </Field>
        {update.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(update.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
