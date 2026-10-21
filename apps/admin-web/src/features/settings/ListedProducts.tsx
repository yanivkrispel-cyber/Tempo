import type { Schemas } from "@tempo/api-client";
import { Button, Checkbox, DateInput, Field, Icon, Input, Select } from "../../shared/design-system";
import type { PassProduct } from "../passes/queries";
import styles from "./settings.module.css";

export type ListedProduct = Schemas["ListedProduct"];

/** The API's limits on the listed set (SL-4, SL-5). */
export const MAX_LISTED = 20;
export const BLURB_LIMIT = 120;

/** " · ₪45" after a product's name, or nothing when it has no price. */
function priceText(agorot: number | null | undefined): string {
  if (agorot == null) return "";
  const amount = (agorot / 100).toLocaleString("he-IL", {
    minimumFractionDigits: agorot % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return ` · ₪${amount}`;
}

/** A name such as "TRX 5 שיעורים": Latin text then a number, which a right-to-left page shows as "5 שיעורים TRX". */
export function startsLatinThenNumber(name: string): boolean {
  return /^\s*[A-Za-z][^\s֐-׿]*\s+\d/.test(name);
}

/**
 * "מה מופיע בעמוד" (SL-4, SL-5): the products strangers see on the prices page, in the owner's order, each with a
 * short line, and an offer for newcomers with its last day. Only active products can be listed: the API rejects an
 * archived one, so none is offered here and none is sent back.
 */
export function ListedProducts({
  listed,
  products,
  disabled,
  onChange,
}: {
  listed: ListedProduct[];
  products: PassProduct[];
  disabled: boolean;
  onChange: (next: ListedProduct[]) => void;
}) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const addable = products.filter(
    (product) => product.status === "active" && !listed.some((item) => item.productId === product.id),
  );

  const update = (index: number, patch: Partial<ListedProduct>) =>
    onChange(listed.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...listed];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="tp-field">
      <span className="tp-field__label" id="listed-products">
        מה מופיע בעמוד
      </span>
      <p className="tp-field__help">
        כרטיסיות ומנויים שכל אחד רואה בעמוד המחירים, לפי הסדר כאן. ההצעות למצטרפים חדשים קודם.
      </p>
      {listed.length > 0 && (
        <ol className={styles.listed} aria-labelledby="listed-products">
          {listed.map((item, index) => {
            const product = byId.get(item.productId)!;
            return (
              <li key={item.productId} className={styles.listedRow}>
                <div className={styles.listedHead}>
                  <strong className={styles.listedName}>{`${product.name}${priceText(product.priceAgorot)}`}</strong>
                  {!disabled && (
                    <span className={styles.listedActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`הזזה למעלה: ${product.name}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <Icon name="arrow-up" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`הזזה למטה: ${product.name}`}
                        disabled={index === listed.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <Icon name="arrow-down" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`הסרה מהעמוד: ${product.name}`}
                        onClick={() => onChange(listed.filter((_, at) => at !== index))}
                      >
                        הסרה
                      </Button>
                    </span>
                  )}
                </div>
                {startsLatinThenNumber(product.name) && (
                  <p className={`tp-field__help ${styles.nameHint}`}>
                    <Icon name="info" />
                    שם שמתחיל בעברית ייקרא נכון מימין לשמאל
                  </p>
                )}
                <Field label="משפט קצר" help={`${(item.blurb ?? "").length} מתוך ${BLURB_LIMIT} תווים.`}>
                  <Input
                    value={item.blurb ?? ""}
                    maxLength={BLURB_LIMIT}
                    placeholder="למשל: מתאים למי שמתחילה"
                    aria-label={`משפט קצר: ${product.name}`}
                    disabled={disabled}
                    onChange={(event) => update(index, { blurb: event.target.value || null })}
                  />
                </Field>
                <Checkbox
                  label="הצעה למצטרפים חדשים"
                  checked={item.newcomersOnly}
                  disabled={disabled}
                  onChange={(event) =>
                    update(index, {
                      newcomersOnly: event.target.checked,
                      publicUntil: event.target.checked ? item.publicUntil : null,
                    })
                  }
                />
                {item.newcomersOnly && (
                  <Field label="היום האחרון להצעה" help="אחריו ההצעה יורדת מהעמוד. ריק: בלי תאריך סיום.">
                    <DateInput
                      aria-label={`היום האחרון להצעה: ${product.name}`}
                      value={item.publicUntil}
                      disabled={disabled}
                      onChange={(value) => update(index, { publicUntil: value })}
                    />
                  </Field>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!disabled && listed.length < MAX_LISTED && (
        <Select
          aria-label="הוספת מוצר לעמוד"
          value=""
          disabled={addable.length === 0}
          onChange={(event) => {
            const productId = event.target.value;
            if (productId) onChange([...listed, { productId, newcomersOnly: false, publicUntil: null, blurb: null }]);
          }}
        >
          <option value="">{addable.length === 0 ? "כל המוצרים כבר בעמוד" : "הוספת מוצר לעמוד"}</option>
          {addable.map((product) => (
            <option key={product.id} value={product.id}>
              {`${product.name}${priceText(product.priceAgorot)}`}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
