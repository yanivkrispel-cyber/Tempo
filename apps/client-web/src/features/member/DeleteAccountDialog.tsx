import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { useAccount } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, Dialog, Field, Input } from "../../shared/design-system";

/** The studios a 409 `account.sole_owner` names, by their names from GET /me (ids for any it doesn't know). */
export function soleOwnerStudios(error: unknown, memberships: { organization: { id: string; displayName: string } }[]) {
  if (!(error instanceof TempoApiError) || error.code !== "account.sole_owner") return [];
  const ids = (error.problem as { organizationIds?: unknown } | null)?.organizationIds;
  if (!Array.isArray(ids)) return [];
  return ids.map(
    (id) => memberships.find((membership) => membership.organization.id === id)?.organization.displayName ?? String(id),
  );
}

/** The typed email matches the account's, ignoring case and spaces at the ends, as the API compares them. */
export function emailMatches(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * Deletes the caller's login (`DELETE /api/v1/me`, docs/32 section 9, A-1 and A-2). The studio keeps its record of
 * the person; the login, the studio access and the device notifications go. A recent sign-in and the account's email
 * typed are required; the only owner of a studio hands it over first. Afterwards the person is signed out.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const me = useAccount();
  const queryClient = useQueryClient();
  const { client } = useAuth();
  const { pathname } = useLocation();
  const [typed, setTyped] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/me", { body: { confirmEmail: typed.trim() } })),
    onSuccess: () => {
      // The login is gone: nothing cached for it may outlive it on this device.
      queryClient.clear();
      client?.signOut();
    },
  });
  const mismatch = emailMatches(typed, me.email) ? null : "כתבו את כתובת המייל של החשבון, בדיוק כפי שהיא מופיעה.";
  const stepUp = hasCode(remove.error, "auth.step_up_required");
  const owned = soleOwnerStudios(remove.error, me.memberships);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!mismatch) remove.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="מחיקת החשבון"
      description="ההתחברות שלך תימחק לצמיתות. אי אפשר לבטל את זה."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="delete-account" variant="danger" loading={remove.isPending}>
            מחיקת החשבון
          </Button>
        </>
      }
    >
      <form id="delete-account" className="tp-stack" onSubmit={submit} noValidate>
        <div className="tp-stack" style={{ gap: 4 }}>
          <h3 className="tp-label">מה נמחק</h3>
          <ul className="tp-muted">
            <li>ההתחברות שלך: לא תוכלו להיכנס עם החשבון הזה.</li>
            <li>הגישה לכל הסטודיואים שלך.</li>
            <li>ההתראות בטלפון, העדפות ההתראות וההודעות באפליקציה.</li>
          </ul>
        </div>
        <div className="tp-stack" style={{ gap: 4 }}>
          <h3 className="tp-label">מה נשאר בסטודיו</h3>
          <p className="tp-muted">
            הרשומה שלך בסטודיו: השם, השיעורים, הנוכחות, הכרטיסיות והמנויים. אלה הרשומות של הסטודיו. אפשר לבקש מהסטודיו
            למחוק אותן.
          </p>
        </div>
        <Field
          label="כתובת המייל של החשבון"
          required
          help={
            <>
              כדי לאשר, כתבו <bdi dir="ltr">{me.email}</bdi>
            </>
          }
          error={submitted ? (mismatch ?? undefined) : undefined}
        >
          <Input
            type="email"
            dir="ltr"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        {owned.length > 0 ? (
          <Banner tone="warning" icon="info">
            {owned.length === 1 ? (
              <>
                לסטודיו <bdi>{owned[0]}</bdi> אין בעלים נוסף מלבדך.
              </>
            ) : (
              <>
                לסטודיואים <bdi>{owned.join(", ")}</bdi> אין בעלים נוסף מלבדך.
              </>
            )}{" "}
            לפני המחיקה העבירו את הבעלות לאדם אחר: במסוף הניהול, בעמוד חברי הסטודיו, בתפריט של האדם, בחרו "העברת
            הבעלות".
          </Banner>
        ) : (
          remove.isError && (
            <Banner tone={stepUp ? "warning" : "danger"} icon="info">
              {errorMessage(remove.error, "לא הצלחנו למחוק את החשבון. נסו שוב.")}
            </Banner>
          )
        )}
        {stepUp && (
          <Button variant="secondary" icon="user" onClick={() => void client?.signIn(pathname, "reauthenticate")}>
            התחברות מחדש
          </Button>
        )}
      </form>
    </Dialog>
  );
}
