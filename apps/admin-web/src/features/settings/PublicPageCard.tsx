import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { CopyLink } from "../../shared/CopyLink";
import {
  ACCENTS,
  Banner,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  TimeInput,
  useToast,
  type AccentId,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { usePassProducts, type PassProduct } from "../passes/queries";
import { QrCode } from "../security/QrCode";
import { initials } from "./BrandCard";
import { ListedProducts, type ListedProduct } from "./ListedProducts";
import styles from "./settings.module.css";

type PublicPage = Schemas["PublicPage"];
type Device = "phone" | "computer";

const devices: { value: Device; label: string }[] = [
  { value: "phone", label: "טלפון" },
  { value: "computer", label: "מחשב" },
];

// `suggestWeeklyAt` is "sun 09:00" in the studio's time (M-13).
const weekDays = [
  { value: "sun", label: "ראשון" },
  { value: "mon", label: "שני" },
  { value: "tue", label: "שלישי" },
  { value: "wed", label: "רביעי" },
  { value: "thu", label: "חמישי" },
  { value: "fri", label: "שישי" },
  { value: "sat", label: "שבת" },
];

export const publicPageKey = (organizationId: string) => ["studio", organizationId, "public-page"] as const;

/** "sun 09:00" to its day and time; off when null or not in that shape. */
export function parseWeekly(value: string | null): { day: string; time: string } | null {
  const match = /^(sun|mon|tue|wed|thu|fri|sat) (\d{2}:\d{2})$/.exec(value ?? "");
  return match ? { day: match[1]!, time: match[2]! } : null;
}

/** The intro offer as the members app's public page says it (publicText.ts there): "שיעור ניסיון · ₪45". */
export function offerLabel(product: Pick<PassProduct, "name" | "priceAgorot">): string {
  const agorot = product.priceAgorot;
  if (agorot == null) return product.name;
  const amount = (agorot / 100).toLocaleString("he-IL", {
    minimumFractionDigits: agorot % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${product.name} · ₪${amount}`;
}

/**
 * Settings, "עמוד ציבורי" (docs/37 section 4.4, MO2): whether strangers see the studio's week (M-7), whether they may
 * join from it without a code (M-9), the intro offer a newcomer gets to pay at the studio (M-8), the studio's
 * Instagram (M-15) and the weekly story suggestion (M-13), with a preview of the page at phone and computer width
 * that follows the form before it is saved, and the page's link and QR once it is on.
 */
export function PublicPageCard() {
  const api = useApi();
  const { organizationId } = useStudio();
  const page = useQuery({
    queryKey: publicPageKey(organizationId),
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/public-page", { params: { path: { organizationId } } })),
  });
  const products = usePassProducts();

  return (
    <Card as="section" aria-labelledby="public-page">
      <h2 id="public-page">עמוד ציבורי</h2>
      <p className="tp-caption">
        עמוד שכל אחד יכול לפתוח מקישור בסטורי או בוואטסאפ: מערכת השיעורים, ההצעה למצטרפים חדשים והרשמה. בלי פרטים של
        מתאמנים.
      </p>
      {page.isError || products.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(page.error ?? products.error, "לא הצלחנו לטעון את העמוד הציבורי. נסו שוב.")}
        </Banner>
      ) : !page.data || !products.data ? (
        <Skeleton height={320} />
      ) : (
        // Keyed by version: after a save the form starts again from what the API returned.
        <PublicPageForm key={page.data.version} page={page.data} products={products.data} />
      )}
    </Card>
  );
}

function PublicPageForm({ page, products }: { page: PublicPage; products: PassProduct[] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const { organizationId } = studio;
  const editable = studio.can("organization.settings.manage");
  const [enabled, setEnabled] = useState(page.enabled);
  const [openJoin, setOpenJoin] = useState(page.openJoin);
  const [introProductId, setIntroProductId] = useState(page.introProductId ?? "");
  const [instagram, setInstagram] = useState(page.instagramHandle ? `@${page.instagramHandle}` : "");
  const weekly = parseWeekly(page.suggestWeeklyAt);
  const [suggestDay, setSuggestDay] = useState(weekly?.day ?? "");
  const [suggestTime, setSuggestTime] = useState<string | null>(weekly?.time ?? "09:00");
  const [device, setDevice] = useState<Device>("phone");
  // Only active products can be listed (the API rejects an archived one), so an archived one is left out of the set.
  const activeIds = new Set(products.filter((product) => product.status === "active").map((product) => product.id));
  const savedListed = page.listedProducts.filter((item) => activeIds.has(item.productId));
  const [listed, setListed] = useState<ListedProduct[]>(savedListed);

  const save = useMutation({
    mutationKey: [organizationId, "settings.updatePublicPage"],
    mutationFn: (body: Schemas["PublicPageInput"]) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/public-page", {
          params: { path: { organizationId }, header: { "If-Match": page.version } },
          body,
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(publicPageKey(organizationId), updated);
      toast.show({
        tone: "success",
        icon: "check",
        message: updated.enabled && !page.enabled ? "העמוד הציבורי פעיל" : "העמוד הציבורי נשמר",
      });
    },
  });

  // An archived product stays listed while it is the one picked, so the form says what is saved.
  const offers = products.filter((product) => product.status === "active" || product.id === page.introProductId);
  const offer = offers.find((product) => product.id === introProductId) ?? null;
  const suggestWeeklyAt = suggestDay && suggestTime ? `${suggestDay} ${suggestTime}` : null;
  const handle = instagram.trim();
  const changed =
    enabled !== page.enabled ||
    openJoin !== page.openJoin ||
    (introProductId || null) !== page.introProductId ||
    suggestWeeklyAt !== page.suggestWeeklyAt ||
    handle.replace(/^@/, "") !== (page.instagramHandle ?? "") ||
    JSON.stringify(listed) !== JSON.stringify(savedListed);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    save.mutate({
      enabled,
      openJoin,
      introProductId: introProductId || null,
      suggestWeeklyAt,
      instagramHandle: handle || null,
      // Not on this form (stage B, M-17): sent back as it is.
      referralRewardProductId: page.referralRewardProductId,
      // Sent only when changed: it replaces the set, and the array order is the public order.
      ...(JSON.stringify(listed) !== JSON.stringify(savedListed) && { listedProducts: listed }),
    });
  };

  return (
    // At a computer's width the preview takes more of the row, so the page's narrow column reads as it will.
    <div className={device === "computer" ? `${styles.brand} ${styles.brandWide}` : styles.brand}>
      <figure className={styles.preview} aria-label="תצוגה מקדימה של העמוד הציבורי">
        <Segmented label="תצוגה" options={devices} value={device} onChange={setDevice} />
        <PublicPagePreview device={device} enabled={enabled} openJoin={openJoin} offer={offer} />
        <figcaption className="tp-caption tp-muted">
          {enabled ? "כך העמוד ייראה אחרי השמירה." : "העמוד כבוי: מי שיפתח את הקישור יראה שהסטודיו לא נמצא."}
        </figcaption>
      </figure>
      <form className={`tp-stack ${styles.brandForm}`} onSubmit={submit} noValidate>
        <Checkbox
          label="העמוד הציבורי פעיל"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={!editable}
        />
        <div className="tp-stack" style={{ gap: 4 }}>
          <Checkbox
            label="הצטרפות פתוחה"
            checked={openJoin}
            onChange={(event) => setOpenJoin(event.target.checked)}
            disabled={!editable || !enabled}
          />
          <p className="tp-field__help">
            {openJoin
              ? "כל מי שנכנס לעמוד יכול להצטרף לסטודיו ולהירשם לשיעור, אחרי אימות המייל."
              : "רק מי שקיבל קישור הצטרפות מהסטודיו יכול להצטרף."}
          </p>
        </div>
        <Field label="הצעה למצטרפים חדשים" help="ניתנת פעם אחת לכל מצטרף חדש מהעמוד, לתשלום בסטודיו.">
          <Select
            value={introProductId}
            onChange={(event) => setIntroProductId(event.target.value)}
            disabled={!editable || !enabled}
          >
            <option value="">בלי הצעה</option>
            {offers.map((product) => (
              <option key={product.id} value={product.id}>
                {offerLabel(product)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="האינסטגרם של הסטודיו" help="מופיע על הכרטיסים שמתאמנים משתפים. ריק: בלי תיוג.">
          <Input
            value={instagram}
            dir="ltr"
            autoComplete="off"
            placeholder="@studio.name"
            onChange={(event) => setInstagram(event.target.value)}
            disabled={!editable}
          />
        </Field>
        <ListedProducts listed={listed} products={products} disabled={!editable || !enabled} onChange={setListed} />
        <div className="tp-field">
          <span className="tp-field__label" id="suggest-weekly">
            הצעה שבועית לסטורי
          </span>
          <div className={styles.weekly} role="group" aria-labelledby="suggest-weekly">
            <Select
              aria-label="יום"
              value={suggestDay}
              onChange={(event) => setSuggestDay(event.target.value)}
              disabled={!editable}
            >
              <option value="">כבויה</option>
              {weekDays.map((day) => (
                <option key={day.value} value={day.value}>
                  {`יום ${day.label}`}
                </option>
              ))}
            </Select>
            {suggestDay && (
              <TimeInput aria-label="שעה" value={suggestTime} onChange={setSuggestTime} disabled={!editable} />
            )}
          </div>
          <p className="tp-field__help">תזכורת בקונסולה לשתף את מערכת השבוע, בשעון הסטודיו.</p>
        </div>
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור את העמוד הציבורי. נסו שוב.")}
          </Banner>
        )}
        {editable && (
          <div>
            <Button type="submit" loading={save.isPending} disabled={!changed}>
              {enabled && !page.enabled ? "שמירה והפעלת העמוד" : "שמירה"}
            </Button>
          </div>
        )}
        {page.enabled && <PageLink />}
      </form>
    </div>
  );
}

/** The page's address and its QR, from the studio's manifest: `start_url` is `<members app>/s/<slug>/`. */
function PageLink() {
  const api = useApi();
  const { slug } = useStudio();
  const manifest = useQuery({
    queryKey: ["studio-manifest", slug],
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/studios/{slug}/manifest.webmanifest", { params: { path: { slug } } })),
    staleTime: 10 * 60_000,
  });
  const url = manifest.data?.["start_url"];
  if (typeof url !== "string" || !url) return null;
  return (
    <div className={styles.pageLink}>
      <CopyLink link={url} label="הקישור לעמוד" note="אפשר לשים אותו בביו של האינסטגרם או לשלוח בוואטסאפ." />
      <QrCode value={url} label="קוד QR לעמוד הציבורי" />
    </div>
  );
}

/**
 * The public page drawn small with the form's choices: the studio's logo, name and accent from its brand, the offer
 * and the join button; the classes are shapes, so what reads is what the form changes.
 */
function PublicPagePreview({
  device,
  enabled,
  openJoin,
  offer,
}: {
  device: Device;
  enabled: boolean;
  openJoin: boolean;
  offer: PassProduct | null;
}) {
  const api = useApi();
  const studio = useStudio();
  const { organizationId } = studio;
  // The brand card's query: one request for both cards.
  const brand = useQuery({
    queryKey: ["studio", organizationId, "brand"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/brand", { params: { path: { organizationId } } })),
  });
  const accentId: AccentId = brand.data?.accentId ?? "sage";
  const accent = ACCENTS.find((item) => item.id === accentId)!.ground;
  const logo = brand.data?.logoSmallUrl;

  return (
    <div className={device === "phone" ? styles.sitePhone : styles.siteBrowser} data-off={!enabled || undefined}>
      {device === "computer" && (
        <span className={styles.siteChrome} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <div className={styles.sitePage} aria-hidden="true">
        <div className={styles.siteColumn}>
          <span className={styles.siteBrand}>
            {logo ? (
              <img className={styles.siteLogo} src={logo} alt="" />
            ) : (
              <span className={styles.siteLogo} style={{ background: accent }}>
                {initials(studio.displayName)}
              </span>
            )}
            <bdi>{studio.displayName}</bdi>
          </span>
          <span className={styles.siteHero}>
            <small>מערכת השיעורים</small>
            <strong>
              <bdi>{studio.displayName}</bdi>
            </strong>
          </span>
          {offer && (
            <span className={styles.siteOffer}>
              <small>פעם ראשונה בסטודיו?</small>
              <strong>{offerLabel(offer)}</strong>
              <small>נרשמים כאן, משלמים בסטודיו.</small>
            </span>
          )}
          {[64, 48, 56].map((width) => (
            <span key={width} className={styles.siteRow}>
              <span className={styles.siteTime} />
              <span className={styles.siteLines}>
                <span className={styles.siteBar} style={{ width: `${width}%` }} />
                <span className={styles.siteBar} style={{ width: `${width - 20}%`, opacity: 0.6 }} />
              </span>
            </span>
          ))}
          {openJoin && (
            <span className={styles.siteJoin} style={{ background: accent }}>
              הצטרפות לסטודיו
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
