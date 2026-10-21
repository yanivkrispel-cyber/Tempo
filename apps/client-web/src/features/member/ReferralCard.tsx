import { useEffect } from "react";
import { Banner, Button, Card, Toggle, useToast } from "../../shared/design-system";
import { useReferralLink, useReferralReward } from "./experience";
import styles from "./member.module.css";

/**
 * "הביאי חברה" (docs/37 section 8.5, M-17): her own link to the studio, sent or copied. When the friend's first class
 * is attended, she gets the studio's reward, which the card names; the friend is promised nothing. Text only: no
 * card image, and the invite names her by first name unless she turns it off (SL-8).
 */
export function ReferralCard({
  organizationId,
  slug,
  studioName,
}: {
  organizationId: string;
  slug: string;
  studioName: string;
}) {
  const toast = useToast();
  const referral = useReferralLink(organizationId);
  const mint = referral.mutate;
  // Made when the card shows, so a tap opens the share sheet at once (BookedDialog). Without `showName`: opening her
  // profile keeps her choice (SL-8); only the switch changes it.
  useEffect(() => mint(undefined), [mint]);
  const link = referral.data;
  // Her stored choice (null is the default, on); while a change is on its way, the one she just made.
  const showName = link ? (link.showName ?? true) : (referral.variables ?? true);
  const reward = useReferralReward(slug, link?.code).data;

  async function share() {
    if (!link) return;
    if (navigator.share) {
      await navigator.share({ text: `בואי איתי ל${studioName}`, url: link.url }).catch(() => undefined);
      return;
    }
    await copy();
  }
  async function copy() {
    if (!link) return;
    await navigator.clipboard?.writeText(link.url).catch(() => undefined);
    toast.show({ message: "הקישור הועתק" });
  }

  return (
    <Card as="section" className={styles.settings} aria-labelledby="referral">
      <h2 id="referral" className={`tp-label tp-muted ${styles.settingsTitle}`}>
        הביאי חברה
      </h2>
      <p className="tp-caption">
        {reward ? (
          <>
            כשחברה שהזמנת מגיעה לשיעור הראשון שלה, את מקבלת <bdi>{reward}</bdi>.
          </>
        ) : (
          "שלחי לחברה את הקישור שלך לסטודיו."
        )}
      </p>
      {referral.isError ? (
        <div className={styles.referralActions}>
          <Banner tone="danger" icon="info">
            לא הצלחנו להכין את הקישור שלך.
          </Banner>
          <Button variant="ghost" size="sm" onClick={() => mint(referral.variables)}>
            נסו שוב
          </Button>
        </div>
      ) : (
        <div className={styles.referralActions}>
          <Button variant="secondary" icon="share" disabled={!link} onClick={() => void share()}>
            שליחה לחברה
          </Button>
          <Button variant="ghost" disabled={!link} onClick={() => void copy()}>
            העתקת הקישור
          </Button>
        </div>
      )}
      <Toggle
        checked={showName}
        disabled={referral.isPending}
        onChange={(event) => mint(event.target.checked)}
        label="להציג את השם שלי"
      />
    </Card>
  );
}
