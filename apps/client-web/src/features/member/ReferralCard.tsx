import { useEffect } from "react";
import { Banner, Button, Card, Toggle, useToast } from "../../shared/design-system";
import { useMyReferral, useReferralLink } from "./experience";
import styles from "./member.module.css";

/**
 * "הביאי חברה" (docs/37 section 8.5, M-17): her own link to the studio, sent or copied. When the friend's first class
 * is attended, she gets the studio's reward, which the card names; the friend is promised nothing. Text only: no
 * card image, and the invite names her by first name unless she turns it off (SL-8).
 */
export function ReferralCard({ organizationId, studioName }: { organizationId: string; studioName: string }) {
  const toast = useToast();
  const mine = useMyReferral(organizationId);
  const referral = useReferralLink(organizationId);
  const mint = referral.mutate;
  // Read, and made only when she has none yet, so a tap opens the share sheet at once (BookedDialog): Safari shares
  // only inside the tap. Without `showName`: making it keeps the default (SL-8); only the switch changes it.
  const missing = mine.data?.link === null;
  useEffect(() => {
    if (missing) mint(undefined);
  }, [missing, mint]);
  const link = referral.data ?? mine.data?.link ?? undefined;
  // Her stored choice (null is the default, on); while a change is on its way, the one she just made.
  const showName = referral.isPending ? (referral.variables ?? true) : (link?.showName ?? true);
  const reward = mine.data?.reward?.productName.trim() || null;
  const failed = mine.isError || referral.isError;

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
      {failed ? (
        <div className={styles.referralActions}>
          <Banner tone="danger" icon="info">
            לא הצלחנו להכין את הקישור שלך.
          </Banner>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (mine.isError ? void mine.refetch() : mint(referral.variables))}
          >
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
        disabled={!link || referral.isPending}
        onChange={(event) => mint(event.target.checked)}
        label="להציג את השם שלי"
      />
    </Card>
  );
}
