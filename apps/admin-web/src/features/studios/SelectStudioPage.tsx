import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { consoleStudios, meKey, membershipRoleName, studioHome, useAccount } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, ButtonLink, Card, EmptyState, Field, Icon, Input, useToast } from "../../shared/design-system";
import { securityPath } from "../security/securityPath";

/** Lowercase Latin letters, digits and hyphens, 3 to 40 characters (contract, `Slug`). */
const slugPattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** `/select-organization` (docs/06 section 5): the studios this account manages, and opening a new one. */
export function SelectStudioPage() {
  const me = useAccount();
  const { client } = useAuth();
  const studios = consoleStudios(me);

  return (
    <main className="tp-page tp-page--narrow tp-stack">
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <h1>הסטודיואים שלך</h1>
        <div className="tp-row">
          <ButtonLink to={securityPath} variant="ghost" icon="shield">
            אבטחת החשבון
          </ButtonLink>
          <Button variant="ghost" icon="log-out" onClick={() => client?.signOut()}>
            התנתקות
          </Button>
        </div>
      </header>

      {studios.length === 0 ? (
        <EmptyState title="עוד אין לך סטודיו לניהול" icon="home">
          פתחו סטודיו חדש למטה, או בקשו מבעלי הסטודיו הזמנה לצוות.
        </EmptyState>
      ) : (
        <nav aria-label="בחירת סטודיו" className="tp-stack">
          {studios.map((membership) => (
            <Link key={membership.membershipId} to={studioHome(membership)} className="tp-card tp-row">
              <span className="tp-rail__logo tp-rail__logo--sm" aria-hidden="true">
                {membership.organization.displayName.replace(/^סטודיו\s+/, "").charAt(0)}
              </span>
              <span className="tp-stack" style={{ gap: 2, flex: 1 }}>
                <strong>{membership.organization.displayName}</strong>
                <span className="tp-caption tp-muted">{membershipRoleName(membership)}</span>
              </span>
              <Icon name="chevron-left" />
            </Link>
          ))}
        </nav>
      )}

      <CreateStudio />
    </main>
  );
}

function CreateStudio() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const create = useMutation({
    // The contract's defaults, sent explicitly (the generated type requires them); the settings screen changes them.
    mutationFn: (body: { displayName: string; slug: string }) =>
      unwrap(
        api.POST("/api/v1/organizations", { body: { ...body, timeZone: "Asia/Jerusalem", defaultLocale: "he-IL" } }),
      ),
    onSuccess: async (studio) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: "success", icon: "check", message: `${studio.displayName} נפתח` });
      void navigate(`/o/${studio.slug}`);
    },
  });

  const name = displayName.trim();
  const nameError = name.length < 2 ? "שם של 2 תווים לפחות" : name.length > 100 ? "עד 100 תווים" : null;
  const slugError = !slugPattern.test(slug)
    ? "3 עד 40 תווים: אותיות לטיניות קטנות, ספרות ומקפים, בלי מקף בהתחלה או בסוף"
    : hasCode(create.error, "organization.slug_taken")
      ? errorMessage(create.error)
      : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || !slugPattern.test(slug)) return;
    create.mutate({ displayName: name, slug });
  };

  return (
    <Card as="section" aria-labelledby="new-studio">
      <form className="tp-stack" onSubmit={submit} noValidate>
        <h2 id="new-studio">פתיחת סטודיו חדש</h2>
        <p className="tp-muted">החשבון שלך יהיה הבעלים של הסטודיו.</p>
        <Field label="שם הסטודיו" required error={submitted ? nameError : undefined}>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} />
        </Field>
        <Field
          label="כתובת"
          required
          help="מופיעה בכתובת הניהול, למשל studio-neshima"
          error={submitted ? slugError : undefined}
        >
          <Input
            dir="ltr"
            className="tp-ltr"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {create.isError && !hasCode(create.error, "organization.slug_taken") && (
          <Banner tone="danger" icon="info">
            {errorMessage(create.error, "לא הצלחנו לפתוח את הסטודיו. נסו שוב.")}
          </Banner>
        )}
        <div>
          <Button type="submit" icon="plus" loading={create.isPending}>
            פתיחת הסטודיו
          </Button>
        </div>
      </form>
    </Card>
  );
}
