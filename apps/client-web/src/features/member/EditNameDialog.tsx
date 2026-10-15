import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/errors";
import { useUpdateMe } from "../../account/account";
import { Button, Dialog, Field, Input, useToast } from "../../shared/design-system";

export interface EditNameDialogProps {
  open: boolean;
  onClose: () => void;
  /** The current display name, or "" when there is none. */
  name: string;
}

/** Changes the account's display name (`PATCH /api/v1/me`). */
export function EditNameDialog({ open, onClose, name }: EditNameDialogProps) {
  return open ? <EditNameForm onClose={onClose} name={name} /> : null;
}

function EditNameForm({ onClose, name }: Omit<EditNameDialogProps, "open">) {
  const [value, setValue] = useState(name);
  const [touched, setTouched] = useState(false);
  const update = useUpdateMe();
  const toast = useToast();
  const trimmed = value.trim();
  const invalid = trimmed === "" ? "צריך שם לתצוגה" : trimmed.length > 100 ? "עד 100 תווים" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    if (trimmed === name) return onClose();
    update.mutate(
      { displayName: trimmed },
      {
        onSuccess: () => {
          toast.show({ tone: "success", icon: "check", message: "השם עודכן" });
          onClose();
        }
      }
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="עריכת פרטים"
      description="השם שהסטודיו והמתאמנים האחרים רואים."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="edit-name" loading={update.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="edit-name" onSubmit={submit} noValidate>
        <Field label="שם לתצוגה" required error={(touched && invalid) || (update.isError ? errorMessage(update.error, "לא הצלחנו לשמור. נסו שוב.") : undefined)}>
          <Input value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} autoComplete="name" />
        </Field>
      </form>
    </Dialog>
  );
}
