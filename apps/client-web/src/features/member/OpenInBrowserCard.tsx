import { inAppBrowser, openInBrowserWay } from "../../app/inAppBrowser";
import { Card } from "../../shared/design-system";
import styles from "./member.module.css";

/**
 * After booking inside Instagram, Facebook or TikTok (SL-7, board ו): the booking is saved, and the real browser is
 * where the studio goes on the home screen. Android opens Chrome by an intent link; iOS has none, so it gets one line
 * saying where the browser button is. Nothing shows in a real browser.
 */
export function OpenInBrowserCard({ url = window.location.href, agent }: { url?: string; agent?: string }) {
  if (!inAppBrowser(agent)) return null;
  const way = openInBrowserWay(url, agent);
  return (
    <Card tone="elevated" className={styles.openInBrowser}>
      <p>המקום שמור. כדי להוסיף את הסטודיו למסך הבית, פתחו את הדף בדפדפן. שם נכנסים שוב עם קוד במייל.</p>
      {way.kind === "android" ? (
        <a className="tp-btn tp-btn--secondary tp-btn--sm" href={way.href}>
          פתיחה בדפדפן
        </a>
      ) : (
        <p className="tp-caption">בפינה העליונה של המסך, ב-⋯, בחרו ״פתיחה בדפדפן״.</p>
      )}
    </Card>
  );
}
