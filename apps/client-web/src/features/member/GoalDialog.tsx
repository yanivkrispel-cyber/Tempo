import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/errors";
import { Button, Dialog, Field, Input, useToast } from "../../shared/design-system";
import { goalRange, useSetMonthlyGoal } from "./progress";

export interface GoalDialogProps {
  organizationId: string;
  /** The current goal, or null when none is set. */
  goal: number | null;
  onClose: () => void;
}

/** Sets or clears the monthly goal (G-1): a whole number of classes from 1 to 31. */
export function GoalDialog({ organizationId, goal, onClose }: GoalDialogProps) {
  const [value, setValue] = useState(goal === null ? "" : String(goal));
  const [touched, setTouched] = useState(false);
  const save = useSetMonthlyGoal(organizationId);
  const toast = useToast();
  const number = Number(value.trim());
  const invalid =
    value.trim() === "" || !Number.isInteger(number) || number < goalRange.min || number > goalRange.max
      ? `מספר שלם בין ${goalRange.min} ל-${goalRange.max}`
      : null;

  const send = (next: number | null) =>
    save.mutate(next, {
      onSuccess: () => {
        toast.show({ tone: "success", icon: "check", message: next === null ? "היעד הוסר" : "היעד נשמר" });
        onClose();
      },
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    if (number === goal) return onClose();
    send(number);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="יעד חודשי"
      description="כמה שיעורים בחודש תרצו להגיע. רק שיעורים שהגעתם אליהם נספרים."
      actions={
        <>
          {goal !== null && (
            <Button variant="ghost-danger" onClick={() => send(null)} disabled={save.isPending}>
              הסרת היעד
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="monthly-goal" loading={save.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="monthly-goal" onSubmit={submit} noValidate>
        <Field
          label="שיעורים בחודש"
          required
          error={
            (touched && invalid) || (save.isError ? errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.") : undefined)
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            min={goalRange.min}
            max={goalRange.max}
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
