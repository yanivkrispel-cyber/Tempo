import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { categoryOptions, useClassTypes } from "../../shared/studio/classTypes";
import { wholeNumber } from "../../shared/utilities/numbers";
import {
  allowance,
  categoryScope,
  daysLabel,
  kindLabels,
  passKeys,
  priceLabel,
  toAgorot,
  usePassProducts,
  type PassKind,
  type PassProduct,
} from "./queries";

/**
 * `/o/:slug/passes`: the punch cards and memberships the studio sells (docs/29 section 5.1). A product never changes
 * once granted, so there is no edit: archive it and add a new one.
 */
export function PassProductsPage() {
  const studio = useStudio();
  const products = usePassProducts();
  const [show, setShow] = useState<"active" | "archived">("active");
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<PassProduct | null>(null);
  const manage = studio.can("passes.manage");
  const rows = (products.data ?? []).filter((product) => product.status === show);

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">מכירות</span>
          <h1>כרטיסיות ומנויים</h1>
        </div>
        {manage && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            מוצר חדש
          </Button>
        )}
      </header>

      <Segmented
        label="אילו מוצרים"
        value={show}
        onChange={setShow}
        options={[
          { value: "active", label: "נמכרים" },
          { value: "archived", label: "בארכיון" },
        ]}
      />

      {products.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(products.error, "לא הצלחנו לטעון את המוצרים. נסו שוב.")}
        </Banner>
      ) : !products.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את המוצרים…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="credit-card"
          title={show === "archived" ? "אין מוצרים בארכיון." : "עוד אין כרטיסיות או מנויים."}
        >
          {show === "active"
            ? "כדי להירשם לשיעור צריך כרטיסייה או מנוי בתוקף. מוסיפים כאן מוצר, ונותנים אותו למתאמן מכרטיס האדם."
            : undefined}
        </EmptyState>
      ) : (
        <div className="tp-table-wrap">
          <table className="tp-table">
            <caption className="tp-sr-only">כרטיסיות ומנויים</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">סוג</th>
                <th scope="col">מה כולל</th>
                <th scope="col">תוקף</th>
                <th scope="col">שיעורים</th>
                <th scope="col">מחיר</th>
                {manage && show === "active" && (
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>
                    <Chip tone={product.kind === "membership" ? "brand" : "neutral"}>{kindLabels[product.kind]}</Chip>
                  </td>
                  <td>{allowance(product.kind, product.entries, product.weeklyCap)}</td>
                  <td>{daysLabel(product.validDays)}</td>
                  <td>{categoryScope(product.classCategory)}</td>
                  <td className="tp-num">{priceLabel(product.priceAgorot)}</td>
                  {manage && show === "active" && (
                    <td style={{ textAlign: "end" }}>
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        onClick={() => setArchiving(product)}
                        aria-label={`העברת ${product.name} לארכיון`}
                      >
                        לארכיון
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <ProductDialog onClose={() => setCreating(false)} />}
      {archiving && <ArchiveDialog product={archiving} onClose={() => setArchiving(null)} />}
    </>
  );
}

function ArchiveDialog({ product, onClose }: { product: PassProduct; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const archive = useMutation({
    mutationKey: [organizationId, "passes.archive"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/pass-products/{productId}/archive", {
          params: { path: { organizationId, productId: product.id } },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: passKeys.products(organizationId) });
      toast.show({ tone: "success", icon: "check", message: "המוצר עבר לארכיון" });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`להפסיק למכור את ${product.name}?`}
      description="כרטיסיות ומנויים שכבר ניתנו ממשיכים לעבוד עד סוף התוקף. אי אפשר להחזיר מוצר מהארכיון."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate()}>
            העברה לארכיון
          </Button>
        </>
      }
    >
      {archive.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(archive.error, "לא הצלחנו להעביר לארכיון. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}

const inRange = (value: number | null, min: number, max: number) => value !== null && value >= min && value <= max;

function ProductDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const classTypes = useClassTypes();
  const [kind, setKind] = useState<PassKind>("punch_card");
  const [name, setName] = useState("");
  const [entries, setEntries] = useState("10");
  const [validDays, setValidDays] = useState("90");
  const [unlimited, setUnlimited] = useState(true);
  const [weeklyCap, setWeeklyCap] = useState("2");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const capped = kind === "membership" && !unlimited;
  const errors = {
    name: name.trim() === "" ? "צריך שם" : null,
    entries: kind === "punch_card" && !inRange(wholeNumber(entries), 1, 200) ? "בין 1 ל־200" : null,
    validDays: !inRange(wholeNumber(validDays), 1, 730) ? "בין 1 ל־730 ימים" : null,
    weeklyCap: capped && !inRange(wholeNumber(weeklyCap), 1, 14) ? "בין 1 ל־14" : null,
    price: price.trim() !== "" && toAgorot(price) === null ? "סכום בשקלים, למשל 450 או 99.90" : null,
  };

  const create = useMutation({
    mutationKey: [organizationId, "passes.create"],
    mutationFn: () => {
      const body: Schemas["CreatePassProductRequest"] = {
        kind,
        name: name.trim(),
        validDays: wholeNumber(validDays)!,
        ...(kind === "punch_card" ? { entries: wholeNumber(entries)! } : {}),
        ...(capped ? { weeklyCap: wholeNumber(weeklyCap)! } : {}),
        ...(category ? { classCategory: category } : {}),
        ...(price.trim() ? { priceAgorot: toAgorot(price)! } : {}),
      };
      return unwrap(
        api.POST("/api/v1/organizations/{organizationId}/pass-products", {
          params: { path: { organizationId } },
          body,
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: passKeys.products(organizationId) });
      toast.show({ tone: "success", icon: "check", message: "המוצר נוסף" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).every((error) => error === null)) create.mutate();
  };
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      title="מוצר חדש"
      description="אחרי שנותנים את המוצר למישהו אי אפשר לשנות אותו, כדי שכל כרטיסייה תמשיך לכלול את מה שנמכר."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="pass-product" loading={create.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="pass-product" className="tp-stack" onSubmit={submit} noValidate>
        <Segmented
          label="סוג המוצר"
          value={kind}
          onChange={setKind}
          options={[
            { value: "punch_card", label: "כרטיסייה" },
            { value: "membership", label: "מנוי לתקופה" },
          ]}
        />
        <Field label="שם" required error={shown("name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder={kind === "punch_card" ? "למשל כרטיסיית 10 כניסות" : "למשל מנוי חודשי ללא הגבלה"}
          />
        </Field>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          {kind === "punch_card" && (
            <Field label="כניסות" required error={shown("entries")}>
              <Input
                inputMode="numeric"
                value={entries}
                onChange={(event) => setEntries(event.target.value)}
                style={{ maxWidth: 120 }}
              />
            </Field>
          )}
          <Field label="תוקף בימים" required error={shown("validDays")} help="מיום ההתחלה.">
            <Input
              inputMode="numeric"
              value={validDays}
              onChange={(event) => setValidDays(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
        </div>
        {kind === "membership" && (
          <div className="tp-stack" style={{ gap: 8 }}>
            <Checkbox
              label="ללא הגבלת שיעורים"
              checked={unlimited}
              onChange={(event) => setUnlimited(event.target.checked)}
            />
            {capped && (
              <Field label="שיעורים בשבוע" required error={shown("weeklyCap")} help="שבוע מתחיל ביום ראשון.">
                <Input
                  inputMode="numeric"
                  value={weeklyCap}
                  onChange={(event) => setWeeklyCap(event.target.value)}
                  style={{ maxWidth: 120 }}
                />
              </Field>
            )}
          </div>
        )}
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="שיעורים">
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">כל השיעורים</option>
              {categoryOptions((classTypes.data ?? []).map((item) => item.category)).map((option) => (
                <option key={option.value} value={option.value}>
                  רק {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="מחיר בשקלים" error={shown("price")} help="לתצוגה בלבד, עוד אין חיוב.">
            <Input
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              style={{ maxWidth: 140 }}
            />
          </Field>
        </div>
        {create.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(create.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
