import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, Dialog, Field, Textarea, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";

/**
 * Erases a person's data (docs/27 section 4.7): names, birth date, contacts and relationships go; the record stays
 * as "נמחק" for bookings and payments that point at it. Owner only, with a recent sign-in. The reason is required
 * but the API does not keep it, so it may say why without naming anyone.
 */
export function EraseDialog({ personId, name, onClose }: { personId: string; name: string; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { client } = useAuth();
  const { pathname } = useLocation();
  const { organizationId } = useStudio();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const erase = useMutation({
    mutationKey: [organizationId, "people.erase"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/erase", {
          params: { path: { organizationId, personId } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: async (erased) => {
      queryClient.setQueryData(["studio", organizationId, "person", personId], erased);
      await queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] });
      toast.show({ tone: "success", icon: "check", message: "הנתונים נמחקו" });
      onClose();
    },
  });
  const length = reason.trim().length;
  const invalid = length < 5 ? "כתבו סיבה, 5 תווים לפחות" : length > 500 ? "עד 500 תווים" : null;
  const stepUp = hasCode(erase.error, "auth.step_up_required");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid) erase.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="מחיקת הנתונים"
      description={`השם, תאריך הלידה, פרטי הקשר והקשרים של ${name} יימחקו לצמיתות. אי אפשר לבטל את זה.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="erase" variant="danger" loading={erase.isPending}>
            מחיקה לצמיתות
          </Button>
        </>
      }
    >
      <form id="erase" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="סיבה" required help="לא נשמרת ביומן. אל תכתבו שמות." error={submitted ? invalid : undefined}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} />
        </Field>
        {erase.isError && (
          <Banner tone={stepUp ? "warning" : "danger"} icon="info">
            {errorMessage(erase.error, "לא הצלחנו למחוק. נסו שוב.")}
          </Banner>
        )}
        {stepUp && (
          <Button variant="secondary" icon="log-out" onClick={() => void client?.signIn(pathname, "reauthenticate")}>
            התחברות מחדש
          </Button>
        )}
      </form>
    </Dialog>
  );
}
