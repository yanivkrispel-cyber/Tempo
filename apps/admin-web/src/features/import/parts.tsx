import { useId, useState, type DragEvent, type ReactNode } from "react";
import { Banner, Card, CardTitle, Chip, Icon, cx, type ChipTone } from "../../shared/design-system";
import { MAX_ROWS, type CsvFile, type ReadProblem } from "./csv";
import styles from "./import.module.css";

/* What the people import and the pass import (docs/40 section 9) share on screen. */

export function FileCard({
  picked,
  problem,
  reading,
  onChoose,
  children,
}: {
  picked: { name: string; file: CsvFile } | null;
  problem: ReadProblem | null;
  reading: boolean;
  onChoose: (file: File | undefined) => void;
  /** What the file should hold, in the import's own words. */
  children: ReactNode;
}) {
  const titleId = useId();
  const [dragging, setDragging] = useState(false);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onChoose(event.dataTransfer.files[0]);
  };

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <CardTitle id={titleId}>הקובץ</CardTitle>
      {children}
      <p className={cx("tp-caption", styles.privacy)}>
        <Icon name="shield" />
        הקובץ נקרא במכשיר הזה בלבד. הוא לא נשלח ולא נשמר: לבדיקה ולייבוא נשלחות רק השורות שבו.
      </p>

      <div
        className={styles.drop}
        data-dragging={dragging || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className={styles.dropHint}>אפשר לגרור את הקובץ לכאן, או</span>
        <label className={cx("tp-btn", picked && "tp-btn--secondary", styles.pick)}>
          <Icon name="upload" />
          {picked ? "בחירת קובץ אחר" : "בחירת קובץ"}
          <input
            type="file"
            accept=".csv,text/csv,.txt,text/plain"
            className="tp-sr-only"
            onChange={(event) => {
              onChoose(event.target.files?.[0]);
              // The same file again (after fixing it in Excel) must fire a change too.
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {reading ? (
        <p aria-busy="true" className="tp-caption tp-muted">
          קוראים את הקובץ…
        </p>
      ) : problem ? (
        <Banner tone="danger" icon="info">
          {problemText(problem)}
        </Banner>
      ) : picked ? (
        <p className="tp-caption" role="status">
          <bdi>{picked.name}</bdi>: {picked.file.rows.length.toLocaleString("he-IL")} שורות
        </p>
      ) : null}

      <details className={styles.help}>
        <summary>איך שומרים את הרשימה כקובץ CSV</summary>
        <ul>
          <li>
            באקסל: קובץ, שמירה בשם, ובסוג הקובץ בוחרים <bdi>CSV UTF-8</bdi>.
          </li>
          <li>
            ב־<bdi>Google Sheets</bdi>: קובץ, הורדה, ואז <bdi>CSV</bdi>.
          </li>
          <li>
            קובץ אקסל רגיל (<bdi>xlsx</bdi>) צריך לשמור קודם כ־<bdi>CSV</bdi>.
          </li>
        </ul>
      </details>
    </Card>
  );
}

function problemText(problem: ReadProblem): ReactNode {
  switch (problem.reason) {
    case "too_big":
      return (
        <>
          הקובץ גדול מ־<bdi>2 MB</bdi>. פצלו אותו לכמה קבצים, עד {MAX_ROWS.toLocaleString("he-IL")} שורות בכל אחד.
        </>
      );
    case "too_many_rows":
      return `בקובץ יש ${problem.rows.toLocaleString("he-IL")} שורות, ואפשר לייבא עד ${MAX_ROWS.toLocaleString("he-IL")} בכל פעם. פצלו אותו לכמה קבצים.`;
    case "spreadsheet":
      return (
        <>
          זה קובץ של אקסל או של גיליון אחר. שמרו אותו כקובץ <bdi>CSV</bdi> ובחרו אותו שוב.
        </>
      );
    case "unicode_text":
      return (
        <>
          הקובץ נשמר כטקסט <bdi>Unicode</bdi>. שמרו אותו כ־<bdi>CSV UTF-8</bdi> ובחרו אותו שוב.
        </>
      );
    case "empty":
      return "לא מצאנו בקובץ שורות לייבוא מתחת לשורת הכותרות.";
  }
}

/** The row of chips above an import's results. */
export function TotalsList({
  label,
  items,
}: {
  label: string;
  items: { count: number; text: string; tone: ChipTone }[];
}) {
  return (
    <ul className={styles.totals} aria-label={label}>
      {items.map((item) => (
        <li key={item.text}>
          <Chip tone={item.tone}>
            <span className="tp-num">{item.count.toLocaleString("he-IL")}</span> {item.text}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
