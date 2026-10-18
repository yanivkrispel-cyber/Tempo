import { useState } from "react";
import { useInstall } from "../../app/install";
import { Button, Card, Dialog, Icon } from "../../shared/design-system";
import styles from "./settings.module.css";

/** Safari's steps: an iPhone has no install prompt (board #347, P-3). */
function IosInstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="התקנה באייפון"
      description="שלושה צעדים ב-Safari, והקונסולה על המסך הראשי."
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
          <span>נגעו ב״הוספה״, והאייקון של Tempo ניהול יופיע במסך הבית.</span>
        </li>
      </ol>
    </Dialog>
  );
}

/**
 * The settings' install row (board #347, P-3): the browser's prompt, or the iPhone steps. Hidden where the console
 * cannot be installed or already runs installed.
 */
export function InstallAppCard() {
  const { way, prompt } = useInstall();
  const [steps, setSteps] = useState(false);
  const sheet = steps && <IosInstallSheet onClose={() => setSteps(false)} />;
  if (!way) return sheet || null;
  return (
    <Card as="section" aria-labelledby="install-app">
      <h2 id="install-app">האפליקציה בטלפון ובמחשב</h2>
      <button type="button" className="tp-setting" onClick={() => (way === "ios" ? setSteps(true) : void prompt())}>
        <span className={styles.rowText}>
          <span>התקנת האפליקציה</span>
          <span className="tp-caption">Tempo ניהול על המסך הראשי, ונפתח בנגיעה אחת כמו כל אפליקציה</span>
        </span>
        <Icon name="chevron-left" />
      </button>
      {sheet}
    </Card>
  );
}
