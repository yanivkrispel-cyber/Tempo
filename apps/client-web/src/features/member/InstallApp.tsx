import { useState } from "react";
import { Button, Card, Dialog, Icon, IconButton } from "../../shared/design-system";
import { dismissInstall, installDismissed, useInstall } from "../../app/install";
import styles from "./member.module.css";

/** Safari's steps: an iPhone has no install prompt (board #347, P-3). */
function IosInstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="התקנה באייפון"
      description="שלושה צעדים ב-Safari, ו-Tempo על המסך הראשי."
      actions={<Button onClick={onClose}>הבנתי</Button>}
    >
      <ol className={styles.installSteps}>
        <li>
          <Icon name="share" />
          <span>נגעו בכפתור השיתוף בתחתית המסך.</span>
        </li>
        <li>
          <Icon name="plus" />
          <span>בחרו ״הוספה למסך הבית״.</span>
        </li>
        <li>
          <Icon name="check" />
          <span>נגעו ב״הוספה״, והאייקון של Tempo יופיע במסך הבית.</span>
        </li>
      </ol>
    </Dialog>
  );
}

/** Starts the install: the browser's prompt, or the iPhone steps. */
function useStartInstall() {
  const { way, prompt } = useInstall();
  const [steps, setSteps] = useState(false);
  const start = () => (way === "ios" ? setSteps(true) : void prompt());
  const sheet = steps && <IosInstallSheet onClose={() => setSteps(false)} />;
  return { way, start, sheet };
}

/** The profile's permanent row; hidden where the app cannot be installed or already runs installed. */
export function InstallAppRow() {
  const { way, start, sheet } = useStartInstall();
  if (!way) return null;
  return (
    <>
      <button type="button" className="tp-setting" onClick={start}>
        <span className={styles.settingText}>
          <span>התקנת האפליקציה</span>
          <span className="tp-caption">Tempo על המסך הראשי, בלי לחפש בדפדפן</span>
        </span>
        <Icon name="chevron-left" />
      </button>
      <hr className="tp-divider" />
      {sheet}
    </>
  );
}

/** The home's card, once the member has a class booked; "not now" holds for 30 days. */
export function InstallAppCard() {
  const { way, start, sheet } = useStartInstall();
  const [dismissed, setDismissed] = useState(() => installDismissed());
  if (!way || dismissed) return sheet || null;
  return (
    <Card as="section" small tone="cream" className={styles.installCard} aria-labelledby="install-title">
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className={styles.installIcon} />
      <div className={styles.settingText}>
        <h2 id="install-title" className={styles.installTitle}>
          Tempo על המסך הראשי
        </h2>
        <span className="tp-caption">השיעורים וכרטיס הכניסה בנגיעה אחת, כמו כל אפליקציה.</span>
      </div>
      <Button size="sm" onClick={start}>
        התקנה
      </Button>
      <IconButton
        icon="close"
        size="sm"
        label="לא עכשיו"
        onClick={() => {
          dismissInstall();
          setDismissed(true);
        }}
      />
      {sheet}
    </Card>
  );
}
