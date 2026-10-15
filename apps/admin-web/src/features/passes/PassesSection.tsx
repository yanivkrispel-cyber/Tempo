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
import { addDays, formatDate, formatDayMonth, todayIn, type IsoDate } from "../../shared/utilities/dates";
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
type PassFreeze = Schemas["PassFreeze"];

/** Only a live membership freezes; a punch card answers 409 `pass.not_freezable` (docs/29 section 16.4, C-12). */
const canFreeze = (pass: Pass) => pass.product.kind === "membership" && pass.status === "active";

const frozenDays = (freezes: readonly PassFreeze[]) =>
  freezes.reduce((sum, freeze) => sum + (Date.parse(freeze.endsOn) - Date.parse(freeze.startsOn)) / 86_400_000 + 1, 0);

/** "כרטיסיות ומנויים" on the person card (docs/29 section 5.2): what they hold, entries left, grant and void. */
export function PassesSection({ person }: { person: PersonDetail }) {
  const studio = useStudio();
  const passes = usePersonPasses(person.id);
  const [granting, setGranting] = useState(false);
  const [voiding, setVoiding] = useState<Pass | null>(null);
  const [freezing, setFreezing] = useState<Pass | null>(null);
  const [unfreezing, setUnfreezing] = useState<{ pass: Pass; freeze: PassFreeze } | null>(null);
  const manage = studio.can("passes.manage") && person.status === "active";
  // A pass starts on the studio's today, so granting waits for its time zone.
  const { timeZone } = useStudioTimeZone();
  const today = timeZone ? todayIn(timeZone) : undefined;

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
              today={today}
              onFreeze={manage && today && canFreeze(pass) ? () => setFreezing(pass) : undefined}
              onUnfreeze={manage && pass.status === "active" ? (freeze) => setUnfreezing({ pass, freeze }) : undefined}
              onVoid={manage && pass.status === "active" ? () => setVoiding(pass) : undefined}
            />
          ))}
        </ul>
      )}
      {granting && timeZone && (
        <GrantDialog person={person} today={todayIn(timeZone)} onClose={() => setGranting(false)} />
      )}
      {freezing && today && (
        <FreezeDialog pass={freezing} personId={person.id} today={today} onClose={() => setFreezing(null)} />
      )}
      {unfreezing && (
        <UnfreezeDialog
          pass={unfreezing.pass}
          freeze={unfreezing.freeze}
          personId={person.id}
          onClose={() => setUnfreezing(null)}
        />
      )}
      {voiding && <VoidDialog pass={voiding} personId={person.id} onClose={() => setVoiding(null)} />}
    </Card>
  );
}

function PassItem({
  pass,
  today,
  onFreeze,
  onUnfreeze,
  onVoid,
}: {
  pass: Pass;
  today: IsoDate | undefined;
  onFreeze?: () => void;
  onUnfreeze?: (freeze: PassFreeze) => void;
  onVoid?: () => void;
}) {
  const freezes = pass.freezes ?? [];
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
        <span className="tp-row" style={{ gap: 4 }}>
          {onFreeze && (
            <Button variant="ghost" size="sm" onClick={onFreeze} aria-label={`הקפאת ${pass.product.name}`}>
              הקפאה
            </Button>
          )}
          {onVoid && (
            <Button variant="ghost-danger" size="sm" onClick={onVoid} aria-label={`ביטול ${pass.product.name}`}>
              ביטול
            </Button>
          )}
        </span>
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
      {freezes.length > 0 && (
        <ul
          className="tp-stack"
          style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}
          aria-label={`הקפאות של ${pass.product.name}`}
        >
          {freezes.map((freeze) => {
            const current = today !== undefined && freeze.startsOn <= today && freeze.endsOn >= today;
            const past = today !== undefined && freeze.endsOn < today;
            const upcoming = today !== undefined && freeze.startsOn > today;
            const range = `${formatDayMonth(freeze.startsOn)}–${formatDayMonth(freeze.endsOn)}`;
            return (
              <li key={freeze.id} className="tp-row tp-caption tp-num" style={{ gap: 8 }}>
                <span>
                  {current
                    ? `מוקפא עד ${formatDayMonth(freeze.endsOn)}`
                    : upcoming
                      ? `הקפאה מתוכננת ${range}`
                      : past
                        ? `הוקפא ${range}`
                        : range}
                </span>
                {upcoming && onUnfreeze && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onUnfreeze(freeze)}
                    aria-label={`הסרת ההקפאה ${range}`}
                  >
                    הסרה
                  </Button>
                )}
              </li>
            );
          })}
          <li className="tp-caption tp-muted">
            סך הכול {daysLabel(frozenDays(freezes))} של הקפאה. התוקף מוארך עד {formatDate(pass.endsOn)}.
          </li>
        </ul>
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
    mutationKey: [organizationId, "passes.grant"],
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
    mutationKey: [organizationId, "passes.voidPass"],
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

function FreezeDialog({
  pass,
  personId,
  today,
  onClose,
}: {
  pass: Pass;
  personId: string;
  today: IsoDate;
  onClose: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshPasses(personId);
  const [startsOn, setStartsOn] = useState<IsoDate | null>(today);
  const [endsOn, setEndsOn] = useState<IsoDate | null>(null);
  // The contract: studio dates, inclusive, 1 to 90 days, starting today or later.
  const maxEnd = startsOn ? addDays(startsOn, 89) : undefined;
  const rangeError =
    startsOn && endsOn && endsOn < startsOn
      ? "היום האחרון צריך להיות אחרי תחילת ההקפאה"
      : endsOn && maxEnd && endsOn > maxEnd
        ? "אפשר להקפיא עד 90 ימים בכל פעם"
        : undefined;

  const freeze = useMutation({
    mutationKey: [organizationId, "passes.freeze"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/passes/{passId}/freezes", {
          params: { path: { organizationId, passId: pass.id } },
          body: { startsOn: startsOn!, endsOn: endsOn! },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({ tone: "success", icon: "check", message: "המנוי הוקפא" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (startsOn && endsOn && !rangeError) freeze.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`הקפאת ${pass.product.name}`}
      description={`תוקף המנוי מתארך בימי ההקפאה, ואי אפשר להירשם בהם לשיעורים. הרשמות שכבר נעשו נשארות. עכשיו המנוי בתוקף עד ${formatDate(pass.endsOn)}.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button
            type="submit"
            form="freeze-pass"
            loading={freeze.isPending}
            disabled={!startsOn || !endsOn || Boolean(rangeError)}
          >
            הקפאה
          </Button>
        </>
      }
    >
      <form id="freeze-pass" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="תחילת ההקפאה" required error={startsOn === null ? "בחרו תאריך" : undefined}>
          <DateInput value={startsOn} onChange={setStartsOn} min={today} today={today} />
        </Field>
        <Field label="היום האחרון להקפאה" required help="כולל היום הזה, עד 90 ימים." error={rangeError}>
          <DateInput value={endsOn} onChange={setEndsOn} min={startsOn ?? today} max={maxEnd} today={today} />
        </Field>
        {freeze.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(freeze.error, "לא הצלחנו להקפיא. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function UnfreezeDialog({
  pass,
  freeze,
  personId,
  onClose,
}: {
  pass: Pass;
  freeze: PassFreeze;
  personId: string;
  onClose: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshPasses(personId);
  const unfreeze = useMutation({
    mutationKey: [organizationId, "passes.unfreeze"],
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/passes/{passId}/freezes/{freezeId}", {
          params: { path: { organizationId, passId: pass.id, freezeId: freeze.id } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({ tone: "success", icon: "check", message: "ההקפאה הוסרה" });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="להסיר את ההקפאה?"
      description={`ההקפאה ${formatDate(freeze.startsOn)} עד ${formatDate(freeze.endsOn)} תימחק, ותוקף המנוי יתקצר בימי ההקפאה.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button variant="danger" loading={unfreeze.isPending} onClick={() => unfreeze.mutate()}>
            הסרת ההקפאה
          </Button>
        </>
      }
    >
      {unfreeze.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(unfreeze.error, "לא הצלחנו להסיר את ההקפאה. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}
