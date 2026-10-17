import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { useAccount, type MyMembership } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, Card, Dialog, Field, Input } from "../../shared/design-system";

/** The studios a 409 `account.sole_owner` names, from GET /me (docs/32 section 9). */
export function soleOwnerStudios(error: unknown, memberships: MyMembership[]): MyMembership["organization"][] {
  if (!(error instanceof TempoApiError) || error.code !== "account.sole_owner") return [];
  const ids = (error.problem as { organizationIds?: unknown } | null)?.organizationIds;
  if (!Array.isArray(ids)) return [];
  return memberships.flatMap((membership) =>
    ids.includes(membership.organization.id) ? [membership.organization] : [],
  );
}

/** The account page's last card: delete this login (A-1, A-2), the same flow as the member app's profile. */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card as="section" aria-labelledby="delete-account" className="tp-stack">
      <h2 id="delete-account">מחיקת החשבון</h2>
      <p className="tp-muted">
        ההתחברות שלך והגישה לכל הסטודיואים נמחקות. הרשומה שלך בכל סטודיו נשארת אצלו. בעלים יחידים של סטודיו מעבירים קודם
        את הבעלות.
      </p>
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          מחיקת החשבון
        </Button>
      </div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
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
      queryClient.clear();
      client?.signOut();
    },
  });
  const matches = typed.trim().toLowerCase() === me.email.trim().toLowerCase();
  const stepUp = hasCode(remove.error, "auth.step_up_required");
  const owned = soleOwnerStudios(remove.error, me.memberships);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (matches) remove.mutate();
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
          <Button type="submit" form="delete-account-form" variant="danger" loading={remove.isPending}>
            מחיקת החשבון
          </Button>
        </>
      }
    >
      <form id="delete-account-form" className="tp-stack" onSubmit={submit} noValidate>
        <p>
          <strong>נמחקים:</strong> ההתחברות, הגישה לכל הסטודיואים, ההתראות וההודעות שלך.
        </p>
        <p>
          <strong>נשארים בסטודיו:</strong> הרשומה שלך, השיעורים, הנוכחות, הכרטיסיות והמנויים. אלה הרשומות של הסטודיו.
          אפשר לבקש ממנו למחוק אותן.
        </p>
        <Field
          label="כתובת המייל של החשבון"
          required
          help={
            <>
              כדי לאשר, כתבו <bdi dir="ltr">{me.email}</bdi>
            </>
          }
          error={submitted && !matches ? "כתבו את כתובת המייל של החשבון, בדיוק כפי שהיא מופיעה." : undefined}
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
            <span>
              אין בעלים נוסף מלבדך ב{owned.length === 1 ? "סטודיו הזה" : "סטודיואים האלה"}. לפני המחיקה העבירו את הבעלות
              לאדם אחר, בתפריט שלו בעמוד חברי הסטודיו:
            </span>
            <ul>
              {owned.map((organization) => (
                <li key={organization.id}>
                  <Link to={`/o/${organization.slug}`}>
                    העברת הבעלות ב<bdi>{organization.displayName}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
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
