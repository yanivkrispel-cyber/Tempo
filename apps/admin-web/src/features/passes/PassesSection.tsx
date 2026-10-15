import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  Chip,
  DateInput,
  Dialog,
  Field,
  Input,
  ProgressBar,
  Select,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { formatDate, todayIn, type IsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { useStudioTimeZone } from "../../shared/studio/timeZone";
import {
  allowance,
  categoryScope,
  daysLabel,
  kindLabels,
  passKeys,
  passStatus,
  usePassProducts,
  usePersonPasses,
  type Pass,
} from "./queries";

type PersonDetail = Schemas["PersonDetail"];

/** "כרטיסיות ומנויים" on the person card (docs/29 section 5.2): what they hold, entries left, grant and void. */
export function PassesSection({ person }: { person: PersonDetail }) {
  const studio = useStudio();
  const passes = usePersonPasses(person.id);
  const [granting, setGranting] = useState(false);
  const [voiding, setVoiding] = useState<Pass | null>(null);
  const manage = studio.can("passes.manage") && person.status === "active";
  // A pass starts on the studio's today, so granting waits for its time zone.
  const { timeZone } = useStudioTimeZone();

  return (
    <Card as="section" aria-labelledby="passes" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <h2 id="passes">כרטיסיות ומנויים</h2>
        {manage && (
          <Button variant="secondary" size="sm" icon="plus" disabled={!timeZone} onClick={() => setGranting(true)}>
            מתן כרטיסייה או מנוי
          </Button>
        )}
      </div>
      {passes.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(passes.error, "לא הצלחנו לטעון את הכרטיסיות והמנויים. נסו שוב.")}
        </Banner>
      ) : !passes.data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">טוענים את הכרטיסיות והמנויים…</span>
          <Skeleton height={48} />
        </div>
      ) : passes.data.length === 0 ? (
        <p className="tp-muted">אין כרטיסייה או מנוי. בלי אחד מהם אי אפשר להירשם לשיעורים.</p>
      ) : (
        <ul
          className="tp-stack"
          style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}
          aria-label="כרטיסיות ומנויים, מהחדש לישן"
        >
          {passes.data.map((pass) => (
            <PassItem
              key={pass.id}
              pass={pass}
              onVoid={manage && pass.status === "active" ? () => setVoiding(pass) : undefined}
            />
          ))}
        </ul>
      )}
      {granting && timeZone && (
        <GrantDialog person={person} today={todayIn(timeZone)} onClose={() => setGranting(false)} />
      )}
      {voiding && <VoidDialog pass={voiding} personId={person.id} onClose={() => setVoiding(null)} />}
    </Card>
  );
}

function PassItem({ pass, onVoid }: { pass: Pass; onVoid?: () => void }) {
  const status = passStatus[pass.status];
  const card = pass.product.kind === "punch_card";
  const entries = pass.entries ?? 0;
  const left = pass.entriesLeft ?? Math.max(entries - pass.entriesUsed, 0);
  return (
    <li className="tp-stack" style={{ gap: 6 }}>
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <span className="tp-row" style={{ gap: 8 }}>
          <strong>{pass.product.name}</strong>
          <Chip tone="neutral" plain>
            {kindLabels[pass.product.kind]}
          </Chip>
          <Chip tone={status.tone}>{status.text}</Chip>
        </span>
        {onVoid && (
          <Button variant="ghost-danger" size="sm" onClick={onVoid} aria-label={`ביטול ${pass.product.name}`}>
            ביטול
          </Button>
        )}
      </div>
      <span className="tp-muted tp-num">
        {formatDate(pass.startsOn)} עד {formatDate(pass.endsOn)}
        {" · "}
        {card
          ? left === 1
            ? "נותרה כניסה אחת"
            : `נותרו ${left} מתוך ${entries} כניסות`
          : allowance("membership", null, pass.product.weeklyCap)}
        {" · "}
        {categoryScope(pass.product.classCategory)}
      </span>
      {card && pass.status === "active" && (
        <ProgressBar
          value={left}
          max={Math.max(entries, 1)}
          label={`כניסות שנותרו ב${pass.product.name}`}
          tone="sage"
        />
      )}
      {pass.note && <span className="tp-caption tp-muted">{pass.note}</span>}
    </li>
  );
}

function useRefreshPasses(personId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return () => queryClient.invalidateQueries({ queryKey: passKeys.person(organizationId, personId) });
}

function GrantDialog({ person, today, onClose }: { person: PersonDetail; today: IsoDate; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshPasses(person.id);
  const products = usePassProducts();
  const active = (products.data ?? []).filter((product) => product.status === "active");
  const [productId, setProductId] = useState("");
  const [startsOn, setStartsOn] = useState<IsoDate | null>(today);
  const [note, setNote] = useState("");
  const product = active.find((item) => item.id === productId) ?? active[0];

  const grant = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/passes", {
          params: { path: { organizationId, personId: person.id } },
          body: {
            productId: product!.id,
            ...(startsOn && startsOn !== today ? { startsOn } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({ tone: "success", icon: "check", message: `${product!.name} ניתן ל${person.displayName}` });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (product && startsOn) grant.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`מתן כרטיסייה או מנוי ל${person.displayName}`}
      description="למשל אחרי תשלום בקופה. החיוב עצמו לא עובר דרך Tempo עדיין."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="grant-pass" loading={grant.isPending} disabled={!product || !startsOn}>
            מתן
          </Button>
        </>
      }
    >
      <form id="grant-pass" className="tp-stack" onSubmit={submit} noValidate>
        {products.isError ? (
          <Banner tone="danger" icon="info">
            {errorMessage(products.error, "לא הצלחנו לטעון את המוצרים. נסו שוב.")}
          </Banner>
        ) : (
          products.data &&
          active.length === 0 && (
            <Banner tone="info" icon="info">
              עוד אין מוצרים. מוסיפים כרטיסייה או מנוי בעמוד כרטיסיות ומנויים.
            </Banner>
          )
        )}
        <Field
          label="מוצר"
          required
          help={
            product
              ? `${allowance(product.kind, product.entries, product.weeklyCap)} · בתוקף ${daysLabel(product.validDays)} · ${categoryScope(product.classCategory)}`
              : undefined
          }
        >
          <Select value={product?.id ?? ""} onChange={(event) => setProductId(event.target.value)}>
            {active.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מתחיל ב" required error={startsOn === null ? "בחרו תאריך" : undefined}>
          <DateInput value={startsOn} onChange={setStartsOn} today={today} />
        </Field>
        <Field label="הערה" help="למשל שולם במזומן. נמחקת יחד עם הנתונים של האדם.">
          <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </Field>
        {grant.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(grant.error, "לא הצלחנו לתת את הכרטיסייה. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function VoidDialog({ pass, personId, onClose }: { pass: Pass; personId: string; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshPasses(personId);
  const voidPass = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/passes/{passId}/void", {
          params: { path: { organizationId, passId: pass.id } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({ tone: "success", icon: "check", message: "הכרטיסייה בוטלה" });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`לבטל את ${pass.product.name}?`}
      description="לא יהיה אפשר להירשם איתה לשיעורים חדשים. שיעורים שכבר נרשמו אליהם נשארים. אי אפשר לבטל את הפעולה."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button variant="danger" loading={voidPass.isPending} onClick={() => voidPass.mutate()}>
            ביטול הכרטיסייה
          </Button>
        </>
      }
    >
      {voidPass.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(voidPass.error, "לא הצלחנו לבטל. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}
