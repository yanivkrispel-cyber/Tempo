import { useState } from "react";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  Segmented,
  Skeleton,
  TableScroll,
} from "../../shared/design-system";
import { formatDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { templates } from "../publish/storyData";
import { useSourceReport, type LinkSource, type MarketingChannel, type SourceReport } from "./queries";
import styles from "./reports.module.css";

export const channelLabel: Record<MarketingChannel, string> = {
  story: "סטורי",
  whatsapp: "וואטסאפ",
  bio: "הלינק בביו",
  poster: "פוסטר QR",
  member_card: "שיתוף של מתאמנים",
  referral: "הזמנת חברה",
  other: "אחר",
};

const windows: { value: "7" | "30"; label: string }[] = [
  { value: "7", label: "7 ימים" },
  { value: "30", label: "30 ימים" },
];

/** Links shown before "all of them": the busiest first. */
const TOP_LINKS = 8;

/**
 * "מאיפה הגיעו ההרשמות" (docs/37 section 6, MO4): new members by first touch, bookings by last touch and how many of
 * those were attended, per channel and per link, for the last 7 or 30 days. A live query; nothing about a person.
 */
export function SourcesCard() {
  const studio = useStudio();
  const [days, setDays] = useState<"7" | "30">("7");
  const report = useSourceReport(Number(days) as 7 | 30);

  return (
    <Card as="section" aria-labelledby="sources-title" className="tp-stack">
      <div className={styles.sourcesHead}>
        <div>
          <CardTitle id="sources-title" as="h2">
            מאיפה הגיעו ההרשמות
          </CardTitle>
          <p className="tp-caption tp-muted">מצטרפים חדשים לפי הלינק הראשון שפתחו, והרשמות לשיעורים לפי האחרון.</p>
        </div>
        <Segmented label="טווח" options={windows} value={days} onChange={setDays} />
      </div>
      {report.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(report.error, "לא הצלחנו לטעון את הדוח. נסו שוב.")}
        </Banner>
      ) : !report.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים…</span>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : isEmpty(report.data) ? (
        <div className="tp-stack" style={{ gap: 12 }}>
          <p className="tp-muted">
            {`ב־${days} הימים האחרונים לא הגיעו הרשמות דרך לינקים. כל סטורי וכל הודעת וואטסאפ מעמוד הפרסום מקבלים לינק משלהם, וכאן רואים מה עבד.`}
          </p>
          {(studio.can("marketing.publish") || studio.can("marketing.publish.own")) && (
            <ButtonLink to={`/o/${studio.slug}/publish`} variant="secondary" size="sm" icon="share">
              לעמוד הפרסום
            </ButtonLink>
          )}
        </div>
      ) : (
        <Sources report={report.data} />
      )}
    </Card>
  );
}

function isEmpty(report: SourceReport): boolean {
  return report.byChannel.every((row) => row.members === 0 && row.bookings === 0) && report.byLink.length === 0;
}

function Sources({ report }: { report: SourceReport }) {
  const [all, setAll] = useState(false);
  const channels = report.byChannel.filter((row) => row.members > 0 || row.bookings > 0);
  const total = channels.reduce(
    (sum, row) => ({
      members: sum.members + row.members,
      bookings: sum.bookings + row.bookings,
      attended: sum.attended + row.attended,
    }),
    { members: 0, bookings: 0, attended: 0 },
  );
  const links = [...report.byLink].sort(
    (a, b) => b.members + b.bookings - (a.members + a.bookings) || b.createdAt.localeCompare(a.createdAt),
  );
  const shown = all ? links : links.slice(0, TOP_LINKS);

  return (
    <>
      {channels.length > 0 && (
        <TableScroll label="לפי ערוץ">
          <table className="tp-table tp-table--compact tp-table--stack">
            <caption className="tp-sr-only">ההרשמות לפי ערוץ</caption>
            <thead>
              <tr>
                <th scope="col">ערוץ</th>
                <FigureHeads />
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.channel}>
                  <th scope="row">{channelLabel[row.channel]}</th>
                  <Figures {...row} />
                </tr>
              ))}
            </tbody>
            {channels.length > 1 && (
              <tfoot>
                <tr>
                  <th scope="row">סך הכול</th>
                  <Figures {...total} />
                </tr>
              </tfoot>
            )}
          </table>
        </TableScroll>
      )}

      {links.length > 0 && (
        <TableScroll label="לפי לינק">
          <table className="tp-table tp-table--compact tp-table--stack">
            <caption className="tp-sr-only">ההרשמות לפי לינק</caption>
            <thead>
              <tr>
                <th scope="col">לינק</th>
                <FigureHeads />
              </tr>
            </thead>
            <tbody>
              {shown.map((link) => (
                <tr key={link.linkId}>
                  <th scope="row">
                    <span className={styles.linkName}>{linkTitle(link)}</span>
                    <span className={`tp-caption tp-muted ${styles.linkMeta}`}>
                      <bdi>{formatDate(link.createdAt.slice(0, 10))}</bdi> · <bdi dir="ltr">{link.code}</bdi>
                    </span>
                  </th>
                  <Figures {...link} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {links.length > TOP_LINKS && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "פחות לינקים" : `כל ${links.length} הלינקים`}
        </Button>
      )}
    </>
  );
}

/** "סטורי · השבוע בסטודיו", or the channel alone; a link to one class says so. */
export function linkTitle(link: Pick<LinkSource, "channel" | "template" | "sessionId">): string {
  const template = templates.find((item) => item.id === link.template)?.name;
  const parts = [channelLabel[link.channel], template ?? (link.sessionId ? "שיעור אחד" : null)];
  return parts.filter(Boolean).join(" · ");
}

function FigureHeads() {
  return (
    <>
      <th scope="col" className="tp-num">
        הצטרפו
      </th>
      <th scope="col" className="tp-num">
        נרשמו לשיעור
      </th>
      <th scope="col" className="tp-num">
        הגיעו
      </th>
    </>
  );
}

function Figures({ members, bookings, attended }: { members: number; bookings: number; attended: number }) {
  return (
    <>
      <td className="tp-num" data-label="הצטרפו">
        {members}
      </td>
      <td className="tp-num" data-label="נרשמו לשיעור">
        {bookings}
      </td>
      <td className="tp-num" data-label="הגיעו">
        {attended}
      </td>
    </>
  );
}
