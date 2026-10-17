import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  Chip,
  EmptyState,
  Field,
  Icon,
  Segmented,
  Select,
  TableScroll,
  cx,
  type ChipTone,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import {
  IMPORT_FIELDS,
  MAX_ROWS,
  proposeMapping,
  readImportFile,
  toImportRows,
  type CsvFile,
  type ImportField,
  type Mapping,
  type ReadProblem,
} from "./csv";
import styles from "./import.module.css";

type ImportRow = Schemas["ImportRow"];
type ImportResult = Schemas["ImportPeopleResult"];
type RowResult = Schemas["ImportRowResult"];

const fieldLabels: Record<ImportField, string> = {
  displayName: "שם מלא",
  givenName: "שם פרטי",
  familyName: "שם משפחה",
  phone: "טלפון",
  email: "מייל",
  birthDate: "תאריך לידה",
};

/**
 * `/o/:slug/people/import`: a member list from a CSV file (docs/34; board #321, Z1), behind `people.import`. The file
 * is read on this device and never sent: the console posts its rows, first as a dry run that answers every row, then
 * for real. On a phone it works the same, the tables as cards (D15).
 */
export function ImportPage() {
  const studio = useStudio();
  if (!studio.can("people.import")) {
    return (
      <EmptyState title="אין לך הרשאה לייבא אנשים" titleAs="h1" icon="shield">
        ייבוא מקובץ פתוח לבעלים ולמנהלים של הסטודיו.
      </EmptyState>
    );
  }
  return <Importer />;
}

interface Picked {
  name: string;
  file: CsvFile;
  mapping: Mapping;
}

function Importer() {
  const api = useApi();
  const studio = useStudio();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<ReadProblem | null>(null);
  const [reading, setReading] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const rows = useMemo(() => (picked ? toImportRows(picked.file.rows, picked.mapping) : []), [picked]);

  const send = (dryRun: boolean) =>
    unwrap(
      api.POST("/api/v1/organizations/{organizationId}/people/import", {
        params: { path: { organizationId: studio.organizationId } },
        body: { dryRun, rows },
      }),
    );
  const check = useMutation({ mutationFn: () => send(true) });
  const commit = useMutation({
    mutationFn: () => send(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", studio.organizationId] }),
  });

  /** A new file or a new mapping makes the last check stale. */
  const restart = () => {
    check.reset();
    commit.reset();
    setIncomplete(false);
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    restart();
    setReading(true);
    try {
      const result = await readImportFile(file);
      if (result.ok) {
        setPicked({ name: file.name, file: result.file, mapping: proposeMapping(result.file.header.cells) });
        setProblem(null);
      } else {
        setPicked(null);
        setProblem(result);
      }
    } finally {
      setReading(false);
    }
  };

  const remap = (field: ImportField, column: string) => {
    restart();
    setPicked(
      (current) =>
        current && { ...current, mapping: { ...current.mapping, [field]: column === "" ? undefined : Number(column) } },
    );
  };

  const runCheck = () => {
    if (!picked || !hasName(picked.mapping) || !hasContact(picked.mapping)) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    check.mutate();
  };

  const startOver = () => {
    restart();
    setPicked(null);
    setProblem(null);
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className="tp-eyebrow">אנשים</span>
          <h1>ייבוא מקובץ</h1>
        </div>
        <ButtonLink to=".." relative="path" variant="ghost" size="sm" icon="chevron-right">
          לרשימת האנשים
        </ButtonLink>
      </header>

      {commit.data ? (
        <Done result={commit.data} rows={rows} onAgain={startOver} />
      ) : (
        <>
          <FileCard picked={picked} problem={problem} reading={reading} onChoose={(file) => void choose(file)} />
          {picked && (
            <ColumnsCard
              picked={picked}
              rows={rows}
              onRemap={remap}
              incomplete={incomplete}
              checking={check.isPending}
              checkError={check.isError ? errorMessage(check.error, "הבדיקה לא הצליחה. נסו שוב.") : null}
              onCheck={runCheck}
            />
          )}
          {picked && check.data && (
            <CheckCard
              result={check.data}
              rows={rows}
              importing={commit.isPending}
              importError={commit.isError ? errorMessage(commit.error, "הייבוא לא הצליח. נסו שוב.") : null}
              onImport={() => commit.mutate()}
            />
          )}
        </>
      )}
    </>
  );
}

const hasName = (mapping: Mapping) =>
  mapping.displayName !== undefined || mapping.givenName !== undefined || mapping.familyName !== undefined;
const hasContact = (mapping: Mapping) => mapping.phone !== undefined || mapping.email !== undefined;

/** The row's name as the import will write it: the full name, or the given and family names joined. */
function nameOf(row: ImportRow | undefined): string | null {
  if (!row) return null;
  return row.displayName ?? ([row.givenName, row.familyName].filter(Boolean).join(" ") || null);
}

function peopleCount(count: number): string {
  return count === 1 ? "אדם אחד" : `${count.toLocaleString("he-IL")} אנשים`;
}

function FileCard({
  picked,
  problem,
  reading,
  onChoose,
}: {
  picked: Picked | null;
  problem: ReadProblem | null;
  reading: boolean;
  onChoose: (file: File | undefined) => void;
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
      <p>
        קובץ <bdi>CSV</bdi> עם רשימת המתאמנים: שורה לכל אדם, ובשורה הראשונה שמות העמודות. עד{" "}
        {MAX_ROWS.toLocaleString("he-IL")} שורות בכל פעם.
      </p>
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

function ColumnsCard({
  picked,
  rows,
  onRemap,
  incomplete,
  checking,
  checkError,
  onCheck,
}: {
  picked: Picked;
  rows: ImportRow[];
  onRemap: (field: ImportField, column: string) => void;
  incomplete: boolean;
  checking: boolean;
  checkError: string | null;
  onCheck: () => void;
}) {
  const titleId = useId();
  // Columns with a name or a value; Excel's trailing separators leave empty ones behind.
  const columns = picked.file.header.cells
    .map((name, index) => ({ name, index }))
    .filter(({ name, index }) => name !== "" || picked.file.rows.some((row) => (row.cells[index] ?? "") !== ""));

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <CardTitle id={titleId}>העמודות</CardTitle>
      <p className="tp-caption tp-muted">
        בדקו שכל שדה מגיע מהעמודה הנכונה. צריך שם (מלא, או פרטי ומשפחה) ולפחות טלפון או מייל.
      </p>
      <div className={styles.fields}>
        {IMPORT_FIELDS.map((field) => (
          <Field key={field} label={fieldLabels[field]}>
            <Select
              value={String(picked.mapping[field] ?? "")}
              onChange={(event) => onRemap(field, event.target.value)}
            >
              <option value="">לא בקובץ</option>
              {columns.map(({ name, index }) => (
                <option key={index} value={index}>
                  {name || `עמודה ${index + 1}`}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>

      <h3 className={styles.subtitle}>השורות הראשונות</h3>
      <TableScroll label="השורות הראשונות בקובץ">
        <table className="tp-table tp-table--stack">
          <caption className="tp-sr-only">השורות הראשונות בקובץ</caption>
          <thead>
            <tr>
              <th scope="col">שם</th>
              <th scope="col">שורה</th>
              <th scope="col">טלפון</th>
              <th scope="col">מייל</th>
              <th scope="col">תאריך לידה</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row) => (
              <tr key={row.line}>
                <td>{nameOf(row) ?? <span className="tp-muted">אין שם</span>}</td>
                <td data-label="שורה" className="tp-num">
                  {row.line}
                </td>
                <td data-label="טלפון" data-empty={!row.phone || undefined}>
                  <bdi className="tp-ltr">{row.phone}</bdi>
                </td>
                <td data-label="מייל" data-empty={!row.email || undefined}>
                  <bdi className="tp-ltr">{row.email}</bdi>
                </td>
                <td data-label="תאריך לידה" data-empty={!row.birthDate || undefined}>
                  <bdi className="tp-ltr">{row.birthDate}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {incomplete && (
        <Banner tone="warning" icon="info">
          בחרו עמודה לשם, ולפחות עמודה אחת לטלפון או למייל.
        </Banner>
      )}
      {checkError && (
        <Banner tone="danger" icon="info">
          {checkError}
        </Banner>
      )}
      <div>
        <Button icon="check" loading={checking} onClick={onCheck}>
          {rows.length === 1 ? "בדיקת השורה" : `בדיקת ${rows.length.toLocaleString("he-IL")} השורות`}
        </Button>
      </div>
    </Card>
  );
}

const outcomeChip: Record<RowResult["outcome"], { text: string; tone: ChipTone }> = {
  valid: { text: "ייווצר", tone: "success" },
  created: { text: "נוסף", tone: "success" },
  exists: { text: "כבר בסטודיו", tone: "info" },
  duplicate_in_file: { text: "כפול בקובץ", tone: "warning" },
  invalid: { text: "לא תקין", tone: "danger" },
};

const invalidReasons: Record<string, string> = {
  "display_name required": "חסר שם",
  "display_name too_long": "השם ארוך מ־100 תווים",
  "phone phone.invalid": "מספר הטלפון לא תקין",
  "email email.invalid": "כתובת המייל לא תקינה",
  "contact contact.required": "חסר טלפון או מייל",
  "birth_date birth_date.invalid": "תאריך הלידה לא תקין. למשל 01/05/1990",
};

function reasonOf(row: RowResult): string | null {
  switch (row.outcome) {
    case "invalid":
      return invalidReasons[`${row.field} ${row.code}`] ?? "השורה לא תקינה";
    case "duplicate_in_file":
      return `אותו טלפון או מייל כמו בשורה ${row.duplicateOfLine}`;
    case "exists":
      return "יש בסטודיו מישהו עם אותו טלפון או מייל. הרשומה שלו לא תשתנה.";
    default:
      return row.possibleDuplicate
        ? "יש בסטודיו מישהו עם אותו שם ותאריך לידה. אחרי הייבוא אפשר לבדוק בעמוד הכפילויות."
        : null;
  }
}

function Totals({ totals, done }: { totals: Schemas["ImportTotals"]; done: boolean }) {
  const items = [
    { count: done ? totals.created : totals.valid, text: done ? "נוספו" : "ייווצרו", tone: "success" as const },
    { count: totals.exists, text: "כבר בסטודיו", tone: "info" as const },
    { count: totals.duplicateInFile, text: "כפולים בקובץ", tone: "warning" as const },
    { count: totals.invalid, text: "לא תקינים", tone: "danger" as const },
  ];
  return (
    <ul className={styles.totals} aria-label={`סיכום ${totals.rows.toLocaleString("he-IL")} השורות`}>
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

/** Every row's outcome: a table on a computer, cards on a phone (D15). */
function Results({ result, rows }: { result: ImportResult; rows: ImportRow[] }) {
  const studio = useStudio();
  const byLine = useMemo(() => new Map(rows.map((row) => [row.line, row])), [rows]);
  const problems = result.rows.filter((row) => row.outcome !== "valid" && row.outcome !== "created");
  const [show, setShow] = useState<"all" | "problems">("all");
  const shown = show === "problems" ? problems : result.rows;

  return (
    <>
      {problems.length > 0 && problems.length < result.rows.length && (
        <Segmented
          label="אילו שורות"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: "כל השורות" },
            { value: "problems", label: `שלא ייובאו (${problems.length.toLocaleString("he-IL")})` },
          ]}
        />
      )}
      <TableScroll label="התוצאה לכל שורה">
        <table className="tp-table tp-table--stack">
          <caption className="tp-sr-only">התוצאה לכל שורה</caption>
          <thead>
            <tr>
              <th scope="col">שם</th>
              <th scope="col">שורה</th>
              <th scope="col">פרטים</th>
              <th scope="col">תוצאה</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const name = nameOf(byLine.get(row.line)) ?? "אין שם";
              const reason = reasonOf(row);
              return (
                <tr key={row.line}>
                  <td>
                    {row.personId && (row.outcome === "created" || row.outcome === "exists") ? (
                      <Link to={`/o/${studio.slug}/people/${row.personId}`}>{name}</Link>
                    ) : (
                      name
                    )}
                  </td>
                  <td data-label="שורה" className="tp-num">
                    {row.line}
                  </td>
                  <td data-label="פרטים" data-empty={!reason || undefined}>
                    {reason}
                  </td>
                  <td className="tp-table__end">
                    <Chip tone={outcomeChip[row.outcome].tone}>{outcomeChip[row.outcome].text}</Chip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </>
  );
}

function CheckCard({
  result,
  rows,
  importing,
  importError,
  onImport,
}: {
  result: ImportResult;
  rows: ImportRow[];
  importing: boolean;
  importError: string | null;
  onImport: () => void;
}) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // The check's answer replaces nothing on screen, so say it is there: focus moves to its title.
  useEffect(() => title.current?.focus(), [result]);
  const valid = result.totals.valid;

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} ref={title} tabIndex={-1} className="tp-card__title">
        הבדיקה
      </h2>
      <p className="tp-caption tp-muted">עוד לא נשמר דבר. כך ייראה הייבוא:</p>
      <Totals totals={result.totals} done={false} />
      <Results result={result} rows={rows} />
      {importError && (
        <Banner tone="danger" icon="info">
          {importError}
        </Banner>
      )}
      {valid > 0 ? (
        <div>
          <Button icon="upload" loading={importing} onClick={onImport}>
            {`ייבוא ${peopleCount(valid)}`}
          </Button>
        </div>
      ) : (
        <p>אין בקובץ אנשים חדשים לייבא.</p>
      )}
    </Card>
  );
}

function Done({ result, rows, onAgain }: { result: ImportResult; rows: ImportRow[]; onAgain: () => void }) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const created = result.totals.created;

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} ref={title} tabIndex={-1} className="tp-card__title">
        {created === 0
          ? "לא נוספו אנשים"
          : created === 1
            ? "אדם אחד נוסף לסטודיו"
            : `${peopleCount(created)} נוספו לסטודיו`}
      </h2>
      <p className="tp-caption tp-muted">
        לא נשלחו הזמנות או הודעות, ולא נרשמה הסכמה לדיוור. הזמנה לאפליקציה נשלחת מכרטיס האדם.
      </p>
      <Totals totals={result.totals} done />
      <Results result={result} rows={rows} />
      <div className="tp-row" style={{ gap: 8 }}>
        <ButtonLink to=".." relative="path" icon="users">
          לרשימת האנשים
        </ButtonLink>
        <Button variant="secondary" icon="upload" onClick={onAgain}>
          ייבוא קובץ נוסף
        </Button>
      </div>
    </Card>
  );
}
