import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState } from "react";
import { useApi } from "../../api/ApiProvider";
import { Card, Chip, IconButton, LinkRows, ProgressBar, type LinkRowItem } from "../../shared/design-system";
import { addDays, startOfWeek, todayIn } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { usePassProducts } from "../passes/queries";
import { useClassTypes, useRooms, useSessions, useStudioTimeZone, useTemplates } from "../schedule/queries";

interface Step {
  key: string;
  title: string;
  hint: string;
  path: string;
  done: boolean;
}

const dismissKey = (organizationId: string) => `tempo.setup-checklist.dismissed.${organizationId}`;

function readDismissed(organizationId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(organizationId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(organizationId: string) {
  try {
    window.localStorage.setItem(dismissKey(organizationId), "1");
  } catch {
    // Storage blocked: the checklist closes for this visit only.
  }
}

/**
 * The owner's first hour (board #584, PL-3): the steps from a new studio to its first booking, each read from a list
 * the console already loads, so it needs no endpoint of its own. It shows only to whoever manages the studio's
 * settings, hides once every step is done or the owner closes it (per studio, in this browser), and stays out of the
 * way when a read fails: it is a guide, not a gate.
 */
export function SetupChecklist() {
  const studio = useStudio();
  const [dismissed, setDismissed] = useState(() => readDismissed(studio.organizationId));
  if (!studio.can("organization.settings.manage") || dismissed) return null;
  return (
    <Steps
      onDismiss={() => {
        writeDismissed(studio.organizationId);
        setDismissed(true);
      }}
    />
  );
}

function Steps({ onDismiss }: { onDismiss: () => void }) {
  const api = useApi();
  const { organizationId, slug } = useStudio();
  const brand = useQuery({
    queryKey: ["studio", organizationId, "brand"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/brand", { params: { path: { organizationId } } })),
  });
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });
  const people = useQuery({
    queryKey: ["studio", organizationId, "people", "setup-checklist"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people", {
          params: { path: { organizationId }, query: { status: "active", limit: 1 } },
        }),
      ),
  });
  const rooms = useRooms();
  const classTypes = useClassTypes();
  const templates = useTemplates();
  const products = usePassProducts();
  const { timeZone } = useStudioTimeZone();
  // A booking for this week or the next is the last step; the same window as the schedule's first screen.
  const week = timeZone ? startOfWeek(todayIn(timeZone)) : null;
  const sessions = useSessions(week ?? "", week ? addDays(week, 13) : "");

  const reads = [brand, organization, people, rooms, classTypes, templates, products];
  if (reads.some((read) => read.isError) || sessions.isError) return null;
  if (reads.some((read) => !read.data) || !sessions.data) return null;

  const base = `/o/${slug}`;
  const steps: Step[] = [
    {
      key: "details",
      title: "פרטי הסטודיו",
      hint: "השם, השפה ואזור הזמן",
      path: `${base}/settings#settings-studio`,
      done: true, // The sign-up asks for them, so a studio always starts with this one done.
    },
    {
      key: "brand",
      title: "לוגו וצבעים",
      hint: "מה שהמתאמנים רואים באפליקציה",
      path: `${base}/settings#settings-brand`,
      done: brand.data!.customized,
    },
    {
      key: "room",
      title: "חדר",
      hint: "איפה השיעורים מתקיימים וכמה מקומות יש",
      path: `${base}/rooms`,
      done: rooms.data!.length > 0,
    },
    {
      key: "class-type",
      title: "סוג שיעור",
      hint: "למשל פילאטיס מכשירים או יוגה",
      path: `${base}/class-types`,
      done: classTypes.data!.length > 0,
    },
    {
      key: "weekly",
      title: "שיעורים קבועים",
      hint: "המערכת השבועית שחוזרת כל שבוע",
      path: `${base}/weekly-classes`,
      done: templates.data!.length > 0,
    },
    {
      key: "pass",
      title: "כרטיסייה או מנוי",
      hint: "מה המתאמנים קונים כדי להירשם",
      path: `${base}/passes`,
      done: products.data!.length > 0,
    },
    {
      key: "people",
      title: "מתאמנים",
      hint: "ייבוא מקובץ, הזמנה או הצטרפות בקישור",
      path: `${base}/people/import`,
      done: people.data!.items.length > 0,
    },
    {
      key: "join-link",
      title: "קישור הצטרפות",
      hint: "קישור אחד לשלוח בקבוצת הסטודיו",
      path: `${base}/invitations`,
      done: organization.data!.joinLinkEnabled,
    },
    {
      key: "booking",
      title: "הרשמה ראשונה",
      hint: "מתאמן אחד שנרשם לשיעור השבוע",
      path: `${base}/schedule`,
      done: sessions.data!.some((session) => session.bookedCount > 0),
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  if (doneCount === steps.length) return null;

  // What is left comes first, in the order it is best done; what is done follows, so the next step is on top.
  const ordered = [...steps.filter((step) => !step.done), ...steps.filter((step) => step.done)];
  const items: LinkRowItem[] = ordered.map((step) => ({
    key: step.key,
    title: step.title,
    meta: step.hint,
    aside: step.done ? <Chip tone="success">בוצע</Chip> : undefined,
    to: step.path,
  }));

  return (
    <Card as="section" aria-labelledby="setup-checklist" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div className="tp-stack" style={{ gap: 4, minWidth: 0 }}>
          <h2 id="setup-checklist">מכינים את הסטודיו</h2>
          <p className="tp-caption">
            {doneCount} מתוך {steps.length} שלבים. הבא בתור: {ordered[0]!.title}.
          </p>
        </div>
        <IconButton icon="close" label="סגירת רשימת ההכנה" size="sm" onClick={onDismiss} />
      </div>
      <ProgressBar value={doneCount} max={steps.length} label="ההתקדמות בהכנת הסטודיו" tone="sage" />
      <LinkRows label="שלבי ההכנה" items={items} />
    </Card>
  );
}
