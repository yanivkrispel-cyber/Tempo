import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  Segmented,
  Select,
  Skeleton,
  TableScroll,
  type ChipTone,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import {
  MAX_ROWS,
  PASS_IMPORT_FIELDS,
  proposePassMapping,
  readImportFile,
  toPassImportRows,
  type CsvFile,
  type PassImportField,
  type PassMapping,
  type ReadProblem,
} from "../import/csv";
import styles from "../import/import.module.css";
import { FileCard, TotalsList } from "../import/parts";
import { allowance, kindLabels, usePassProducts } from "./queries";

type PassRow = Schemas["ImportPassRow"];
type PassResult = Schemas["ImportPassesResult"];
type RowResult = Schemas["ImportPassRowResult"];

const fieldLabels: Record<PassImportField, string> = {
  email: "מייל",
  phone: "טלפון",
  product: "מוצר",
  entriesLeft: "כניסות שנותרו",
  validFrom: "בתוקף מתאריך",
  validUntil: "בתוקף עד",
};

/**
 * `/o/:slug/passes/import`: the passes members already hold, from a CSV file (docs/40 section 9). It works like the
 * people import: the file is read on this device, a dry run answers every row, then the rows go in for real. Each row
 * finds a person who is already in the studio, so the page sends whoever opens it to the people import first.
 */
export function PassImportPage() {
  const studio = useStudio();
  if (!studio.can("people.import") || !studio.can("passes.manage")) {
    return (
      <EmptyState title="אין לך הרשאה לייבא כרטיסיות ומנויים" titleAs="h1" icon="shield">
        ייבוא מקובץ פתוח לבעלים ולמנהלים של הסטודיו.
      </EmptyState>
    );
  }
  return <Importer />;
}

interface Picked {
  name: string;
  file: CsvFile;
  mapping: PassMapping;
}

function Importer() {
  const api = useApi();
  const studio = useStudio();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<ReadProblem | null>(null);
  const [reading, setReading] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const rows = useMemo(() => (picked ? toPassImportRows(picked.file.rows, picked.mapping) : []), [picked]);

  const send = (dryRun: boolean) =>
    unwrap(
      api.POST("/api/v1/organizations/{organizationId}/passes/import", {
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
        setPicked({ name: file.name, file: result.file, mapping: proposePassMapping(result.file.header.cells) });
        setProblem(null);
      } else {
        setPicked(null);
        setProblem(result);
      }
    } finally {
      setReading(false);
    }
  };

  const remap = (field: PassImportField, column: string) => {
    restart();
    setPicked(
      (current) =>
        current && { ...current, mapping: { ...current.mapping, [field]: column === "" ? undefined : Number(column) } },
    );
  };

  const runCheck = () => {
    if (!picked || !isComplete(picked.mapping)) {
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
          <span className="tp-eyebrow">מכירות</span>
          <h1>ייבוא כרטיסיות ומנויים</h1>
        </div>
        <ButtonLink to=".." relative="path" variant="ghost" size="sm" icon="chevron-right">
          לכרטיסיות ומנויים
        </ButtonLink>
      </header>

      {commit.data ? (
        <Done result={commit.data} rows={rows} onAgain={startOver} />
      ) : (
        <>
          <Banner tone="info" icon="info">
            קודם מייבאים את האנשים: כל שורה בקובץ מתחברת לאדם שכבר בסטודיו, לפי הטלפון או המייל.{" "}
            <Link to={`/o/${studio.slug}/people/import`}>לייבוא האנשים</Link>
          </Banner>
          <ProductsCard />
          <FileCard picked={picked} problem={problem} reading={reading} onChoose={(file) => void choose(file)}>
            <p>
              קובץ <bdi>CSV</bdi> עם הכרטיסיות והמנויים שבתוקף: שורה לכל אחד, ובשורה הראשונה שמות העמודות. עד{" "}
              {MAX_ROWS.toLocaleString("he-IL")} שורות בכל פעם.
            </p>
          </FileCard>
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

/** The names the file's product column can use: the studio's active products. */
function ProductsCard() {
  const titleId = useId();
  const products = usePassProducts();
  const active = (products.data ?? []).filter((product) => product.status === "active");

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <CardTitle id={titleId}>המוצרים בסטודיו</CardTitle>
      {products.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(products.error, "לא הצלחנו לטעון את המוצרים.")}
        </Banner>
      ) : products.isPending ? (
        <Skeleton height={48} />
      ) : active.length === 0 ? (
        <Banner tone="warning" icon="info">
          אין עדיין מוצרים פעילים, וכל שורה בקובץ צריכה מוצר. קודם מוסיפים אותם בעמוד הכרטיסיות והמנויים.
        </Banner>
      ) : (
        <>
          <p className="tp-caption tp-muted">
            בעמודת המוצר כותבים את השם כמו כאן. בכרטיסייה רושמים כמה כניסות נותרו, ובמנוי משאירים את התא ריק.
          </p>
          <ul className={styles.products}>
            {active.map((product) => (
              <li key={product.id}>
                <bdi>{product.name}</bdi>
                <span className="tp-caption tp-muted">
                  {kindLabels[product.kind]}, {allowance(product.kind, product.entries, product.weeklyCap)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

const isComplete = (mapping: PassMapping) =>
  (mapping.phone !== undefined || mapping.email !== undefined) &&
  mapping.product !== undefined &&
  mapping.validUntil !== undefined;

/** Who the row names, as the file has it: a pass row carries no name, only the contact that finds the person. */
const contactOf = (row: PassRow | undefined) => row?.email ?? row?.phone ?? null;

function passCount(count: number): string {
  return count === 1 ? "כרטיסייה או מנוי אחד" : `${count.toLocaleString("he-IL")} כרטיסיות ומנויים`;
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
  rows: PassRow[];
  onRemap: (field: PassImportField, column: string) => void;
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
        בדקו שכל שדה מגיע מהעמודה הנכונה. צריך טלפון או מייל, מוצר ותאריך סיום. בלי תאריך התחלה, התוקף מתחיל היום.
      </p>
      <div className={styles.fields}>
        {PASS_IMPORT_FIELDS.map((field) => (
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
              <th scope="col">מתאמן</th>
              <th scope="col" className="tp-num">
                שורה
              </th>
              <th scope="col">מוצר</th>
              <th scope="col" className="tp-num">
                כניסות שנותרו
              </th>
              <th scope="col">בתוקף מתאריך</th>
              <th scope="col">בתוקף עד</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row) => (
              <tr key={row.line}>
                <td>
                  {contactOf(row) ? (
                    <bdi className="tp-ltr">{contactOf(row)}</bdi>
                  ) : (
                    <span className="tp-muted">אין טלפון או מייל</span>
                  )}
                </td>
                <td data-label="שורה" className="tp-num">
                  {row.line}
                </td>
                <td data-label="מוצר" data-empty={!row.product || undefined}>
                  <bdi>{row.product}</bdi>
                </td>
                <td data-label="כניסות שנותרו" data-empty={!row.entriesLeft || undefined} className="tp-num">
                  {row.entriesLeft}
                </td>
                <td data-label="בתוקף מתאריך" data-empty={!row.validFrom || undefined}>
                  <bdi className="tp-ltr">{row.validFrom}</bdi>
                </td>
                <td data-label="בתוקף עד" data-empty={!row.validUntil || undefined}>
                  <bdi className="tp-ltr">{row.validUntil}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {incomplete && (
        <Banner tone="warning" icon="info">
          בחרו עמודה למוצר, עמודה לתאריך הסיום, ולפחות עמודה אחת לטלפון או למייל.
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
  valid: { text: "ייובא", tone: "success" },
  created: { text: "יובא", tone: "success" },
  exists: { text: "כבר יובא", tone: "info" },
  duplicate_in_file: { text: "כפול בקובץ", tone: "warning" },
  invalid: { text: "לא תקין", tone: "danger" },
};

/** Every reason the API gives (docs/40 section 3), by field and code. */
const invalidReasons: Record<string, string> = {
  "phone phone.invalid": "מספר הטלפון לא תקין",
  "email email.invalid": "כתובת המייל לא תקינה",
  "contact contact.required": "חסר טלפון או מייל",
  "person person.not_found": "אין בסטודיו אדם עם הטלפון או המייל האלה. קודם מייבאים את האנשים.",
  "person person.ambiguous": "הטלפון או המייל מתאימים ליותר מאדם אחד. אפשר להוסיף את הכרטיסייה מכרטיס האדם.",
  "person person.read_only": "האדם לא פעיל בסטודיו, ולכן אי אפשר להוסיף לו כרטיסייה או מנוי",
  "product required": "חסר שם מוצר",
  "product product.not_found": "אין מוצר פעיל בשם הזה. השמות מופיעים ברשימת המוצרים למעלה.",
  "product product.ambiguous": "יש יותר ממוצר פעיל אחד בשם הזה",
  "entries_left required": "בכרטיסייה צריך לרשום כמה כניסות נותרו",
  "entries_left entries_left.invalid": "מספר הכניסות צריך להיות מספר שלם, 1 ומעלה",
  "entries_left entries_left.too_many": "יותר כניסות ממה שיש במוצר",
  "entries_left entries_left.not_allowed": "למנוי אין כניסות. השאירו את התא ריק.",
  "valid_until required": "חסר תאריך סיום",
  "valid_until date.invalid": "תאריך הסיום לא תקין. למשל 31/12/2026",
  "valid_until valid_until.past": "תאריך הסיום כבר עבר",
  "valid_until valid_until.too_far": "תאריך הסיום רחוק מדי: עד שנתיים מהיום",
  "valid_from date.invalid": "תאריך ההתחלה לא תקין. למשל 01/11/2026",
  "valid_from valid_from.after_until": "תאריך ההתחלה אחרי תאריך הסיום",
};

function reasonOf(row: RowResult): string | null {
  switch (row.outcome) {
    case "invalid":
      return invalidReasons[`${row.field} ${row.code}`] ?? "השורה לא תקינה";
    case "duplicate_in_file":
      return `אותו אדם ואותו מוצר כמו בשורה ${row.duplicateOfLine}`;
    case "exists":
      return "כבר יובא לאדם הזה אותו מוצר עם אותו תאריך סיום. לא נוסף דבר.";
    default:
      return null;
  }
}

function Totals({ totals, done }: { totals: Schemas["ImportTotals"]; done: boolean }) {
  return (
    <TotalsList
      label={`סיכום ${totals.rows.toLocaleString("he-IL")} השורות`}
      items={[
        { count: done ? totals.created : totals.valid, text: done ? "יובאו" : "ייובאו", tone: "success" },
        { count: totals.exists, text: "כבר יובאו", tone: "info" },
        { count: totals.duplicateInFile, text: "כפולים בקובץ", tone: "warning" },
        { count: totals.invalid, text: "לא תקינים", tone: "danger" },
      ]}
    />
  );
}

/** Every row's outcome: a table on a computer, cards on a phone (D15). */
function Results({ result, rows }: { result: PassResult; rows: PassRow[] }) {
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
              <th scope="col">מתאמן</th>
              <th scope="col" className="tp-num">
                שורה
              </th>
              <th scope="col">מוצר</th>
              <th scope="col">פרטים</th>
              <th scope="col">תוצאה</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const source = byLine.get(row.line);
              const contact = <bdi className="tp-ltr">{contactOf(source) ?? "אין טלפון או מייל"}</bdi>;
              const reason = reasonOf(row);
              return (
                <tr key={row.line}>
                  <td>
                    {row.personId ? <Link to={`/o/${studio.slug}/people/${row.personId}`}>{contact}</Link> : contact}
                  </td>
                  <td data-label="שורה" className="tp-num">
                    {row.line}
                  </td>
                  <td data-label="מוצר" data-empty={!source?.product || undefined}>
                    <bdi>{source?.product}</bdi>
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
  result: PassResult;
  rows: PassRow[];
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
            {`ייבוא ${passCount(valid)}`}
          </Button>
        </div>
      ) : (
        <p>אין בקובץ כרטיסיות או מנויים חדשים לייבא.</p>
      )}
    </Card>
  );
}

function Done({ result, rows, onAgain }: { result: PassResult; rows: PassRow[]; onAgain: () => void }) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const created = result.totals.created;

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} ref={title} tabIndex={-1} className="tp-card__title">
        {created === 0 ? "לא נוספו כרטיסיות או מנויים" : `נוספו לסטודיו: ${passCount(created)}`}
      </h2>
      <p className="tp-caption tp-muted">לא נשלחו הודעות למתאמנים. מה שיובא מופיע בכרטיס של כל אדם.</p>
      <Totals totals={result.totals} done />
      <Results result={result} rows={rows} />
      <div className="tp-row" style={{ gap: 8 }}>
        <ButtonLink to=".." relative="path" icon="credit-card">
          לכרטיסיות ומנויים
        </ButtonLink>
        <Button variant="secondary" icon="upload" onClick={onAgain}>
          ייבוא קובץ נוסף
        </Button>
      </div>
    </Card>
  );
}
