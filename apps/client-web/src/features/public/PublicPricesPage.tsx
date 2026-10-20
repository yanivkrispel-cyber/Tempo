import { NotFoundPage } from "../../app/NotFoundPage";
import { useStudioPath } from "../../app/studioPath";
import { Card, Chip, EmptyState, shortDate, Skeleton } from "../../shared/design-system";
import { LoadError } from "../member/StudioGate";
import { PublicFrame, PublicSkeleton, StudioNotFound } from "./PublicFrame";
import { isNotFound, usePublicProducts, usePublicStudio, type PublicProduct, type PublicStudio } from "./publicStudio";
import { perClassText, priceText, validityText } from "./publicText";
import styles from "./public.module.css";

/**
 * The studio's prices, `/s/<slug>/prices` (docs/37 section 4.1, SL-5, board יא): the products the owner listed, in
 * the owner's order, offers first as a card, then punch cards and memberships. Prices are shown only; they are paid
 * at the studio.
 */
export function PublicPricesPage() {
  const slug = useStudioPath();
  if (!slug) return <NotFoundPage />;
  return <Prices slug={slug} />;
}

function Prices({ slug }: { slug: string }) {
  const studio = usePublicStudio(slug);
  if (studio.isPending) return <PublicSkeleton />;
  if (studio.isError) {
    return isNotFound(studio.error) ? (
      <StudioNotFound />
    ) : (
      <PublicFrame studio={null}>
        <LoadError error={studio.error} onRetry={() => void studio.refetch()} />
      </PublicFrame>
    );
  }
  return <PricesView studio={studio.data} />;
}

/** `ended`: the offer page sent the visitor here because its offer is over. */
export function PricesView({ studio, ended = false }: { studio: PublicStudio; ended?: boolean }) {
  const products = usePublicProducts(studio.slug);
  const items = products.data ?? [];
  const offers = items.filter((product) => product.newcomersOnly);
  const cards = items.filter((product) => !product.newcomersOnly && product.kind === "punch_card");
  const memberships = items.filter((product) => !product.newcomersOnly && product.kind === "membership");

  return (
    <PublicFrame studio={studio}>
      <h1 className={styles.sectionTitle}>מחירים</h1>
      {ended && (
        <p className={`tp-muted ${styles.notice}`} role="status">
          המבצע הזה הסתיים. אלה המחירים של <bdi>{studio.name}</bdi> כרגע.
        </p>
      )}
      {products.isPending && <Skeleton height={120} />}
      {products.isError && (
        <LoadError error={products.error} onRetry={() => void products.refetch()}>
          לא הצלחנו לטעון את המחירים
        </LoadError>
      )}
      {products.isSuccess && items.length === 0 && (
        <EmptyState icon="credit-card" title="המחירים יתפרסמו בקרוב">
          אפשר לשאול את הסטודיו.
        </EmptyState>
      )}
      {offers.map((product) => (
        <OfferCard key={product.id} product={product} studio={studio} />
      ))}
      <Group title="כרטיסיות" products={cards} />
      <Group title="מנוי" products={memberships} />
      {items.length > 0 && <p className={`tp-muted ${styles.fine}`}>נרשמים כאן, ומשלמים בסטודיו.</p>}
    </PublicFrame>
  );
}

function OfferCard({ product, studio }: { product: PublicProduct; studio: PublicStudio }) {
  return (
    <Card to={`/o/${product.id}`} selected className={styles.productCard}>
      <div className={styles.productHead}>
        <span className="tp-label tp-muted">
          פעם ראשונה ב<bdi>{studio.name}</bdi>?
        </span>
        {product.publicUntil && <Chip tone="warning">עד {shortDate(product.publicUntil)}</Chip>}
      </div>
      <div className={styles.productHead}>
        <span className={styles.productName}>
          <bdi>{product.name}</bdi>
        </span>
        {product.priceAgorot !== null && <span className={styles.productPrice}>{priceText(product.priceAgorot)}</span>}
      </div>
      <span className="tp-muted">{perClassText(product, "בתוך")}</span>
    </Card>
  );
}

function Group({ title, products }: { title: string; products: PublicProduct[] }) {
  if (products.length === 0) return null;
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className="tp-label tp-muted">{title}</h2>
      <Card>
        <ul className={styles.pickList}>
          {products.map((product) => (
            <li key={product.id} className={styles.priceRow}>
              <span className={styles.priceText}>
                <strong>
                  <bdi>{product.name}</bdi>
                </strong>
                <span className={`tp-muted ${styles.pickMeta}`}>{detail(product)}</span>
              </span>
              {product.priceAgorot !== null && <strong>{priceText(product.priceAgorot)}</strong>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** A card's per-class price and validity; a membership's note, or "תקף ל..." when it has none. */
function detail(product: PublicProduct): string {
  if (product.kind === "punch_card") return perClassText(product);
  return product.blurb ?? `תקף ${validityText(product.validDays)}`;
}
