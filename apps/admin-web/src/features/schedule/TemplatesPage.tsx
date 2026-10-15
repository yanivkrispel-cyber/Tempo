import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Chip,
  DateInput,
  Dialog,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  TableScroll,
  TimeInput,
  useToast,
} from "../../shared/design-system";
import { StudioClock } from "../../shared/studio/StudioClock";
import { addDays, formatDate, todayIn, type IsoDate } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import {
  endTime,
  memberName,
  scheduleKeys,
  useInstructors,
  useRooms,
  useTemplates,
  weekdayNames,
  wholeNumber,
  type ScheduleTemplate,
  type Session,
} from "./queries";

type TemplateChange = Schemas["ScheduleTemplateChange"];

/** `/o/:slug/weekly-classes`: the weekly rules behind the timetable (docs/29 section 4.1), `schedule.manage` only. */
export function TemplatesPage() {
  return <StudioClock>{(timeZone) => <Templates timeZone={timeZone} />}</StudioClock>;
}

function Templates({ timeZone }: { timeZone: string }) {
  const today = todayIn(timeZone);
  const templates = useTemplates();
  const [show, setShow] = useState<"current" | "ended">("current");
  const [editing, setEditing] = useState<ScheduleTemplate | null>(null);
  const [ending, setEnding] = useState<ScheduleTemplate | null>(null);
  const [untouched, setUntouched] = useState<Session[]>([]);

  const ended = (template: ScheduleTemplate) => template.validUntil != null && template.validUntil < today;
  const rows = (templates.data ?? [])
    .filter((template) => (show === "ended") === ended(template))
    .sort((a, b) => a.weekday - b.weekday || a.localStart.localeCompare(b.localStart));
  const onChanged = (change: TemplateChange) => setUntouched(change.untouchedSessions);

  return (
    <>
      <header>
        <span className="tp-eyebrow">לוח שיעורים</span>
        <h1>שיעורים קבועים</h1>
        <p className="tp-muted">
          כל שיעור קבוע פותח שיעורים בלוח לשמונה השבועות הבאים. שינוי חל על שיעורים עתידיים שאין בהם הרשמות.
        </p>
      </header>

      {untouched.length > 0 && (
        <UntouchedSessions sessions={untouched} timeZone={timeZone} onDismiss={() => setUntouched([])} />
      )}

      <Segmented
        label="אילו שיעורים קבועים"
        value={show}
        onChange={setShow}
        options={[
          { value: "current", label: "פעילים" },
          { value: "ended", label: "שהסתיימו" },
        ]}
      />

      {templates.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(templates.error, "לא הצלחנו לטעון את השיעורים הקבועים. נסו שוב.")}
        </Banner>
      ) : !templates.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את השיעורים הקבועים…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={show === "ended" ? "אין שיעורים קבועים שהסתיימו." : "עוד אין שיעורים קבועים."}
        >
          {show === "current" ? "מוסיפים שיעור קבוע מהמערכת השבועית, בכפתור שיעור חדש." : undefined}
        </EmptyState>
      ) : (
        <TableScroll label="שיעורים קבועים">
          <table className="tp-table">
            <caption className="tp-sr-only">שיעורים קבועים</caption>
            <thead>
              <tr>
                <th scope="col">יום ושעה</th>
                <th scope="col">שיעור</th>
                <th scope="col">מדריך.ה</th>
                <th scope="col">חדר</th>
                <th scope="col">מקומות</th>
                <th scope="col">תוקף</th>
                {show === "current" && (
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((template) => {
                const label = `${template.classType.name} ביום ${weekdayNames[template.weekday]} ${template.localStart}`;
                return (
                  <tr key={template.id}>
                    <td>
                      {weekdayNames[template.weekday]}{" "}
                      <span className="tp-num">
                        {template.localStart} עד {endTime(template.localStart, template.minutes)}
                      </span>
                    </td>
                    <td>
                      <bdi>{template.classType.name}</bdi>
                    </td>
                    <td>{template.instructor ? <bdi>{template.instructor.displayName}</bdi> : "—"}</td>
                    <td>{template.room ? <bdi>{template.room.name}</bdi> : "—"}</td>
                    <td className="tp-num">{template.capacity}</td>
                    <td className="tp-num">
                      {template.validUntil ? (
                        `${formatDate(template.validFrom)} עד ${formatDate(template.validUntil)}`
                      ) : (
                        <>
                          מ־{formatDate(template.validFrom)} <Chip tone="success">ללא סיום</Chip>
                        </>
                      )}
                    </td>
                    {show === "current" && (
                      <td style={{ textAlign: "end" }}>
                        <span className="tp-row" style={{ gap: 4, justifyContent: "flex-end" }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(template)}
                            aria-label={`עריכת ${label}`}
                          >
                            עריכה
                          </Button>
                          <Button
                            variant="ghost-danger"
                            size="sm"
                            onClick={() => setEnding(template)}
                            aria-label={`סיום ${label}`}
                          >
                            סיום
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      {editing && (
        <EditTemplateDialog
          template={editing}
          title={editing.classType.name}
          onChanged={onChanged}
          onClose={() => setEditing(null)}
        />
      )}
      {ending && (
        <EndTemplateDialog
          template={ending}
          title={ending.classType.name}
          today={today}
          onChanged={onChanged}
          onClose={() => setEnding(null)}
        />
      )}
    </>
  );
}

/** The sessions a change could not touch because people are booked; each is edited on its own page. */
interface UntouchedSessionsProps {
  sessions: Session[];
  timeZone: string;
  onDismiss: () => void;
}

function UntouchedSessions({ sessions, timeZone, onDismiss }: UntouchedSessionsProps) {
  return (
    <Banner tone="warning" icon="info">
      <div className="tp-stack" style={{ gap: 6 }}>
        <strong>
          {sessions.length === 1 ? "בשיעור אחד" : `ב־${sessions.length} שיעורים`} יש כבר הרשמות, ולכן הם נשארו כמו שהיו.
          אפשר לשנות כל אחד מהם בנפרד:
        </strong>
        <ul style={{ margin: 0 }}>
          {sessions.map((session) => (
            <li key={session.id}>
              <Link to={`../schedule/sessions/${session.id}`} relative="path">
                {session.classType.name}, {formatDate(session.localDate)} {clockTime(session.startsAt, timeZone)}
              </Link>
            </li>
          ))}
        </ul>
        <div>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            הבנתי
          </Button>
        </div>
      </div>
    </Banner>
  );
}

function usePatchTemplate(template: ScheduleTemplate) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationKey: [organizationId, "schedule.patchTemplate"],
    mutationFn: (body: Schemas["UpdateScheduleTemplateRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/schedule-templates/{templateId}", {
          params: { path: { organizationId, templateId: template.id }, header: { "If-Match": template.version } },
          body,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) }),
  });
}

interface ChangeDialogProps {
  template: ScheduleTemplate;
  title: string;
  onChanged: (change: TemplateChange) => void;
  onClose: () => void;
}

function EditTemplateDialog({ template, title, onChanged, onClose }: ChangeDialogProps) {
  const update = usePatchTemplate(template);
  const toast = useToast();
  const rooms = useRooms();
  const instructors = useInstructors();
  const [weekday, setWeekday] = useState(template.weekday);
  const [start, setStart] = useState<string | null>(template.localStart);
  const [minutes, setMinutes] = useState(String(template.minutes));
  const [capacity, setCapacity] = useState(String(template.capacity));
  const [instructorId, setInstructorId] = useState(template.instructorMembershipId ?? "");
  const [roomId, setRoomId] = useState(template.roomId ?? "");
  const [submitted, setSubmitted] = useState(false);

  const minutesValue = wholeNumber(minutes);
  const capacityValue = wholeNumber(capacity);
  const errors = {
    start: start === null ? "בחרו שעה" : null,
    minutes: minutesValue === null || minutesValue < 10 || minutesValue > 300 ? "בין 10 ל־300 דקות" : null,
    capacity: capacityValue === null || capacityValue < 1 || capacityValue > 500 ? "בין 1 ל־500" : null,
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some((error) => error !== null)) return;
    // Only what changed, so an unchanged field never rewrites sessions edited by hand.
    const body: Schemas["UpdateScheduleTemplateRequest"] = {};
    if (weekday !== template.weekday) body.weekday = weekday;
    if (start !== template.localStart) body.localStart = start!;
    if (minutesValue !== template.minutes) body.minutes = minutesValue!;
    if (capacityValue !== template.capacity) body.capacity = capacityValue!;
    if (instructorId !== (template.instructorMembershipId ?? "")) body.instructorMembershipId = instructorId || null;
    if (roomId !== (template.roomId ?? "")) body.roomId = roomId || null;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate(body, {
      onSuccess: (change) => {
        onChanged(change);
        toast.show({ tone: "success", icon: "check", message: "השיעור הקבוע עודכן" });
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`עריכת ${title}`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="edit-template" loading={update.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="edit-template" className="tp-stack" onSubmit={submit} noValidate>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="יום">
            <Select value={String(weekday)} onChange={(event) => setWeekday(Number(event.target.value))}>
              {weekdayNames.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="שעת התחלה" required error={submitted ? errors.start : undefined}>
            <TimeInput value={start} onChange={setStart} />
          </Field>
        </div>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="משך בדקות" required error={submitted ? errors.minutes : undefined}>
            <Input
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
          <Field label="מקומות" required error={submitted ? errors.capacity : undefined}>
            <Input
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
        </div>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="מדריך.ה">
            <Select value={instructorId} onChange={(event) => setInstructorId(event.target.value)}>
              <option value="">בלי מדריך</option>
              {(instructors.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="חדר">
            <Select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              <option value="">בלי חדר</option>
              {(rooms.data ?? [])
                .filter((room) => room.status === "active" || room.id === template.roomId)
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {update.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(update.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function EndTemplateDialog({ template, title, today, onChanged, onClose }: ChangeDialogProps & { today: IsoDate }) {
  const end = usePatchTemplate(template);
  const toast = useToast();
  const earliest = template.validFrom > today ? template.validFrom : today;
  const [lastDay, setLastDay] = useState<IsoDate | null>(earliest);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`לסיים את ${title} ביום ${weekdayNames[template.weekday]}?`}
      description="שיעורים אחרי היום האחרון שאין בהם הרשמות יימחקו מהלוח. שיעורים שיש בהם הרשמות יישארו, ואפשר לבטל אותם אחד אחד."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button
            variant="danger"
            loading={end.isPending}
            disabled={lastDay === null}
            onClick={() =>
              end.mutate(
                { validUntil: lastDay },
                {
                  onSuccess: (change) => {
                    onChanged(change);
                    toast.show({ tone: "success", icon: "check", message: "השיעור הקבוע יסתיים כמתוכנן" });
                    onClose();
                  },
                },
              )
            }
          >
            סיום השיעור הקבוע
          </Button>
        </>
      }
    >
      <Field label="היום האחרון" help={lastDay ? `השיעור האחרון יהיה עד ${formatDate(lastDay)}.` : undefined}>
        <DateInput value={lastDay} onChange={setLastDay} min={earliest} today={today} max={addDays(today, 730)} />
      </Field>
      {end.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(end.error, "לא הצלחנו לסיים את השיעור הקבוע. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}
