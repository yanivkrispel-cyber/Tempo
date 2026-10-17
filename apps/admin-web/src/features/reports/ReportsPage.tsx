import { useState, type ReactNode } from "react";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Card,
  CardTitle,
  Chip,
  DateInput,
  EmptyState,
  Field,
  KpiTile,
  LinkRows,
  Segmented,
  Skeleton,
  TableScroll,
  WeeklyBarChart,
  type KpiChange,
} from "../../shared/design-system";
import { useStudioTimeZone } from "../../shared/studio/timeZone";
import { formatDate, todayIn, type IsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { lastFullWeeks, maxReportDays, periodProblem, shortDay, type Period, type PeriodPreset } from "./period";
import {
  useMembersAtRisk,
  usePassesEnding,
  useReportSummary,
  type MembersAtRiskReport,
  type PassesEndingReport,
  type ReportFigures,
  type ReportSummary,
} from "./queries";
import styles from "./reports.module.css";

const presets: { value: PeriodPreset; label: string }[] = [
  { value: "4", label: "4 שבועות" },
  { value: "8", label: "8 שבועות" },
  { value: "12", label: "12 שבועות" },
  { value: "custom", label: "תאריכים" },
];

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

function countChange(now: number, before: number): KpiChange {
  return { delta: now - before, unit: "" };
}

/** A fill rate's change in percentage points; nothing to compare when either period held nothing. */
function rateChange(now: number | null, before: number | null): KpiChange | null {
  if (now === null || before === null) return null;
  return { delta: Math.round(now * 100) - Math.round(before * 100), unit: "%" };
}

/** `/o/:slug/reports`: the owner's view of a period (docs/32), behind `reports.view`. */
export function ReportsPage() {
  const studio = useStudio();
  const canView = studio.can("reports.view");
  const canSeePeople = canView && studio.can("people.view");
  const { timeZone } = useStudioTimeZone();
  const [preset, setPreset] = useState<PeriodPreset>("4");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);

  const today = timeZone ? todayIn(timeZone) : null;
  const problem = preset === "custom" ? periodProblem(from, to) : null;
  // Four weeks is the server's own default (in the studio's zone); longer presets wait for the studio's clock.
  let period: Period | null = null;
  if (preset === "custom" && !problem) period = { from: from!, to: to! };
  else if (preset === "8" || preset === "12") period = today ? lastFullWeeks(today, Number(preset)) : null;
  const ready = canView && (preset === "4" || period !== null);

  const summary = useReportSummary(period, ready);
  const passesEnding = usePassesEnding(canSeePeople);
  const membersAtRisk = useMembersAtRisk(canSeePeople);

  if (!canView) {
    return (
      <EmptyState title="אין לך גישה לדוחות" titleAs="h1" icon="shield">
        הדוחות פתוחים לבעלים ולמנהלים של הסטודיו.
      </EmptyState>
    );
  }

  const choosePreset = (next: PeriodPreset) => {
    if (next === "custom" && !from && !to && summary.data) {
      // Start from the period on screen, so changing one end is one step.
      setFrom(summary.data.from);
      setTo(summary.data.to);
    }
    setPreset(next);
  };

  return (
    <>
      <header>
        <span className="tp-eyebrow">ניהול</span>
        <h1>דוחות</h1>
        <p className="tp-muted">כמה הגיעו, אילו שיעורים מתמלאים, ומי צריך שיחה. בלי נתוני בריאות.</p>
      </header>

      <section className={`tp-stack ${styles.period}`} aria-label="תקופת הדוח">
        <Segmented label="תקופה" options={presets} value={preset} onChange={choosePreset} />
        {preset === "custom" && (
          // No min or max between the two inputs: moving the period forward types a start after the old end first,
          // and periodProblem explains a backwards or too-long period in words instead.
          <div className={styles.dates}>
            <Field label="מתאריך" required>
              <DateInput value={from} onChange={setFrom} today={today ?? undefined} />
            </Field>
            <Field
              label="עד תאריך"
              required
              help={problem ? undefined : `עד ${maxReportDays} ימים.`}
              error={from && to ? (problem ?? undefined) : undefined}
            >
              <DateInput value={to} onChange={setTo} today={today ?? undefined} />
            </Field>
          </div>
        )}
        {summary.data && (
          <p className="tp-muted" aria-live="polite">
            מ־<bdi>{formatDate(summary.data.from)}</bdi> עד <bdi>{formatDate(summary.data.to)}</bdi>
          </p>
        )}
      </section>

      {!ready ? null : summary.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(summary.error, "לא הצלחנו לטעון את הדוח. נסו שוב.")}
        </Banner>
      ) : !summary.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את הדוח…</span>
          <div className={styles.kpis}>
            <Skeleton height={124} />
            <Skeleton height={124} />
            <Skeleton height={124} />
            <Skeleton height={124} />
          </div>
          <Skeleton height={220} />
        </div>
      ) : (
        <Summary report={summary.data} />
      )}

      {canSeePeople && (
        <div className={styles.lists}>
          <PassesEnding query={passesEnding} slug={studio.slug} />
          <MembersAtRisk query={membersAtRisk} slug={studio.slug} />
        </div>
      )}
    </>
  );
}

function Summary({ report }: { report: ReportSummary }) {
  const { totals, previous } = report;
  const nothingHeld = totals.sessionsHeld === 0;
  return (
    <>
      <div className={`tp-kpis ${styles.kpis}`} role="group" aria-label="מדדי התקופה">
        <KpiTile
          label="ביקורים"
          value={String(totals.attended)}
          change={countChange(totals.attended, previous.attended)}
        />
        <KpiTile
          label="שיעור תפוסה"
          value={totals.fillRate === null ? "—" : percent(totals.fillRate)}
          change={rateChange(totals.fillRate, previous.fillRate)}
        />
        <KpiTile
          label="חברים פעילים"
          value={String(totals.activeMembers)}
          change={countChange(totals.activeMembers, previous.activeMembers)}
        />
        <KpiTile
          label="חברים חדשים"
          value={String(totals.newMembers)}
          change={countChange(totals.newMembers, previous.newMembers)}
        />
      </div>

      <Card as="section" aria-label="ביקורים לפי שבוע">
        <WeeklyBarChart
          title="ביקורים לפי שבוע"
          valueLabel="ביקורים"
          weeks={report.weeks.map((week) => ({
            key: week.weekStart,
            label: shortDay(week.weekStart),
            longLabel: `השבוע של ${shortDay(week.weekStart)}`,
            value: week.attended,
          }))}
        />
      </Card>

      <Card as="section" aria-labelledby="report-class-types" className="tp-stack">
        <CardTitle id="report-class-types">לפי סוג שיעור</CardTitle>
        {nothingHeld ? (
          <p className="tp-muted">לא התקיימו שיעורים בתקופה הזאת.</p>
        ) : (
          <ClassTypesTable rows={report.classTypes} totals={totals} />
        )}
      </Card>
    </>
  );
}

const figureColumns: { key: keyof ReportFigures; label: string }[] = [
  { key: "sessionsHeld", label: "שיעורים" },
  { key: "placesBooked", label: "הזמנות" },
  { key: "attended", label: "הגיעו" },
  { key: "noShow", label: "לא הגיעו" },
  { key: "lateCancellations", label: "ביטולים מאוחרים" },
];

function FigureCells({ figures }: { figures: ReportFigures }) {
  return (
    <>
      {figureColumns.map((column) => (
        <td key={column.key} className="tp-num">
          {figures[column.key] as number}
        </td>
      ))}
      <td className="tp-num">{figures.fillRate === null ? "—" : percent(figures.fillRate)}</td>
    </>
  );
}

function ClassTypesTable({ rows, totals }: { rows: ReportSummary["classTypes"]; totals: ReportFigures }) {
  return (
    <TableScroll label="לפי סוג שיעור">
      <table className="tp-table tp-table--compact">
        <caption className="tp-sr-only">הנתונים לפי סוג שיעור</caption>
        <thead>
          <tr>
            <th scope="col">סוג שיעור</th>
            {figureColumns.map((column) => (
              <th key={column.key} scope="col" className="tp-num">
                {column.label}
              </th>
            ))}
            <th scope="col" className="tp-num">
              תפוסה
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.classTypeId}>
              <th scope="row">
                <Chip tone={`cat-${row.color}`}>{row.name}</Chip>
              </th>
              <FigureCells figures={row} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">סך הכול</th>
            <FigureCells figures={totals} />
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  );
}

interface ListQuery<T> {
  data?: T;
  isError: boolean;
  error: unknown;
}

function ListCard<T extends { items: unknown[]; truncated: boolean }>({
  id,
  title,
  help,
  empty,
  query,
  render,
}: {
  id: string;
  title: string;
  help: string;
  empty: string;
  query: ListQuery<T>;
  render: (data: T) => ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby={id} className="tp-stack">
      <div>
        <CardTitle id={id} as="h2">
          {title}
        </CardTitle>
        <p className="tp-caption tp-muted">{help}</p>
      </div>
      {query.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(query.error, "לא הצלחנו לטעון את הרשימה. נסו שוב.")}
        </Banner>
      ) : !query.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים…</span>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : query.data.items.length === 0 ? (
        <p className="tp-muted">{empty}</p>
      ) : (
        <>
          {render(query.data)}
          {query.data.truncated && <p className="tp-caption tp-muted">מוצגים 50 הראשונים.</p>}
        </>
      )}
    </Card>
  );
}

const personPath = (slug: string, personId: string) => `/o/${slug}/people/${personId}`;

function PassesEnding({ query, slug }: { query: ListQuery<PassesEndingReport>; slug: string }) {
  return (
    <ListCard
      id="report-passes-ending"
      title="כרטיסיות ומנויים שמסתיימים"
      help="מסתיימים בתוך 14 ימים, או שנשארה בהם כניסה אחת."
      empty="אין כרטיסיות או מנויים שמסתיימים בקרוב."
      query={query}
      render={(data) => (
        <LinkRows
          label="כרטיסיות ומנויים שמסתיימים"
          items={data.items.map((item) => ({
            key: item.passId,
            title: item.displayName,
            meta: item.productName,
            aside:
              item.reason === "last_entry" ? (
                "נשארה כניסה אחת"
              ) : (
                <>
                  מסתיים ב־<bdi>{shortDay(item.endsOn)}</bdi>
                </>
              ),
            to: personPath(slug, item.personId),
          }))}
        />
      )}
    />
  );
}

function MembersAtRisk({ query, slug }: { query: ListQuery<MembersAtRiskReport>; slug: string }) {
  return (
    <ListCard
      id="report-members-at-risk"
      title="לא הגיעו 30 ימים"
      help="יש להם כרטיסייה או מנוי בתוקף, ולא הגיעו לשיעור 30 ימים או יותר."
      empty="כל מי שמחזיק כרטיסייה בתוקף הגיע בחודש האחרון."
      query={query}
      render={(data) => (
        <LinkRows
          label="לא הגיעו 30 ימים"
          items={data.items.map((item) => ({
            key: item.personId,
            title: item.displayName,
            meta: item.lastAttendedOn ? (
              <>
                ביקור אחרון: <bdi>{formatDate(item.lastAttendedOn)}</bdi>
              </>
            ) : (
              "עוד לא הגיעו לשיעור"
            ),
            aside: (
              <>
                בתוקף עד <bdi>{shortDay(item.passEndsOn)}</bdi>
              </>
            ),
            to: personPath(slug, item.personId),
          }))}
        />
      )}
    />
  );
}
