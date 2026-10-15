import { useId, useState } from "react";
import { Button, Input } from "./design-system";

/**
 * A link the API shows only once (an invitation or a join link): read-only, selected on focus, with a copy button.
 * When the clipboard is blocked the text stays selected, so Ctrl+C still works.
 */
export function CopyLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();

  const copy = async () => {
    (document.getElementById(id) as HTMLInputElement | null)?.select();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="tp-stack" style={{ gap: 6 }}>
      <label className="tp-label" htmlFor={id}>
        {label}
      </label>
      <div className="tp-row" style={{ flexWrap: "nowrap" }}>
        <Input id={id} readOnly value={link} dir="ltr" className="tp-ltr" onFocus={(event) => event.currentTarget.select()} />
        <Button variant="secondary" icon={copied ? "check" : "share"} onClick={() => void copy()}>
          {copied ? "הועתק" : "העתקה"}
        </Button>
      </div>
      <span className="tp-caption tp-muted" role="status">
        {copied ? "הקישור הועתק. שלחו אותו בהודעה או במייל." : "הקישור מוצג פעם אחת בלבד: העתיקו אותו עכשיו."}
      </span>
    </div>
  );
}
