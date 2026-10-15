import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, isNotFound } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  Dialog,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { StudioClock } from "../../shared/studio/StudioClock";
import { dayOfWeek, formatDate, startOfWeek } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import { RosterSection } from "./RosterSection";
import { SessionMessageDialog } from "./SessionMessageDialog";
import {
  categoryLabel,
  memberName,
  occupancy,
  scheduleKeys,
  sessionBadge,
  useInstructors,
  useRooms,
  useSession,
  weekdayNames,
  wholeNumber,
  type Session,
} from "./queries";

/** `/o/:slug/schedule/sessions/:sessionId`: one class (ClassDetail mockup), laid out phone first. */
export function SessionPage() {
  const { sessionId = "" } = useParams();
  const studio = useStudio();
  const session = useSession(sessionId);

  if (session.isError) {
    return (
      <div className="tp-stack">
        <Banner tone="danger" icon="info">
          {isNotFound(session.error)
            ? "השיעור לא נמצא."
            : errorMessage(session.error, "לא הצלחנו לטעון את השיעור. נסו שוב.")}
        </Banner>
        <ButtonLink to={`/o/${studio.slug}/schedule`} variant="secondary">
          למערכת השבועית
        </ButtonLink>
      </div>
    );
  }

  if (!session.data) {
    return (
      <div aria-busy="true" className="tp-stack">
        <span className="tp-sr-only">טוענים את השיעור…</span>
        <Skeleton height={64} />
        <Skeleton height={200} />
      </div>
    );
  }

  const data = session.data;
  return <StudioClock>{(timeZone) => <SessionDetail session={data} timeZone={timeZone} />}</StudioClock>;
}

function SessionDetail({ session, timeZone }: { session: Session; timeZone: string }) {
  const studio = useStudio();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const cancelled = session.status === "cancelled";
  // When the page opened: a class that started meanwhile still shows its actions until a reload; the API decides.
  const [openedAt] = useState(() => Date.now());
  const started = new Date(session.startsAt).getTime() <= openedAt;
  const manage = studio.can("schedule.manage") && !cancelled;
  const full = session.bookedCount >= session.capacity;
  const instructor = session.instructor?.membershipId === studio.membership.membershipId;
  // Up to a day after the class ends, for the desk and the class's own instructor (docs/29 section 16.2).
  const canMessage =
    (studio.can("bookings.manage") || instructor) &&
    !cancelled &&
    openedAt < new Date(session.endsAt).getTime() + 24 * 60 * 60 * 1000;

  return (
    <>
      <header className="tp-stack" style={{ gap: 6 }}>
        <ButtonLink
          to={`/o/${studio.slug}/schedule?week=${startOfWeek(session.localDate)}`}
          variant="ghost"
          size="sm"
          icon="chevron-right"
        >
          חזרה למערכת השבועית
        </ButtonLink>
        <span className="tp-eyebrow tp-num">
          {weekdayNames[dayOfWeek(session.localDate)]} · {formatDate(session.localDate)}
        </span>
        <div className="tp-row" style={{ justifyContent: "space-between" }}>
          <div className="tp-row">
            <h1>{session.classType.name}</h1>
            <Chip tone={`cat-${session.classType.color}`}>{categoryLabel(session.classType.category)}</Chip>
            {cancelled ? (
              <Chip tone="danger">בוטל</Chip>
            ) : (
              <Chip tone={full ? "warning" : "success"}>{sessionBadge(session)}</Chip>
            )}
          </div>
          {(canMessage || (manage && !started)) && (
            <div className="tp-row" style={{ gap: 8 }}>
              {canMessage && (
                <Button variant="secondary" size="sm" icon="mail" onClick={() => setMessaging(true)}>
                  הודעה לרשומים
                </Button>
              )}
              {manage && !started && (
                <>
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>
                    עריכה
                  </Button>
                  <Button variant="ghost-danger" size="sm" onClick={() => setCancelling(true)}>
                    ביטול השיעור
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <p className="tp-muted tp-num">
          {clockTime(session.startsAt, timeZone)} עד {clockTime(session.endsAt, timeZone)}
          {session.room && ` · ${session.room.name}`}
        </p>
      </header>

      <Card as="section" aria-labelledby="session-details" className="tp-stack">
        <h2 id="session-details">פרטים</h2>
        <dl className="tp-grid" style={{ gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
          <dt className="tp-muted">מדריך.ה</dt>
          <dd>{session.instructor?.displayName ?? "—"}</dd>
          <dt className="tp-muted">חדר</dt>
          <dd>{session.room?.name ?? "—"}</dd>
          <dt className="tp-muted">רשומים</dt>
          <dd className="tp-num">{occupancy(session)}</dd>
          <dt className="tp-muted">בהמתנה</dt>
          <dd className="tp-num">{session.waitlistCount}</dd>
          <dt className="tp-muted">סוג</dt>
          <dd>{session.templateId ? "שיעור קבוע" : "שיעור חד־פעמי"}</dd>
        </dl>
      </Card>

      {/* The roster is for the desk (bookings.manage) and for the class's own instructor (docs/29 section 8). */}
      {(studio.can("bookings.manage") || instructor) && <RosterSection session={session} timeZone={timeZone} />}

      {editing && <EditSessionDialog session={session} onClose={() => setEditing(false)} />}
      {cancelling && <CancelSessionDialog session={session} onClose={() => setCancelling(false)} />}
      {messaging && <SessionMessageDialog session={session} onClose={() => setMessaging(false)} />}
    </>
  );
}

function useRefreshSession(session: Session) {
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return (updated: Session) => {
    queryClient.setQueryData(scheduleKeys.session(organizationId, session.id), updated);
    return queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) });
  };
}

function EditSessionDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshSession(session);
  const rooms = useRooms();
  const instructors = useInstructors();
  const [instructorId, setInstructorId] = useState(session.instructor?.membershipId ?? "");
  const [roomId, setRoomId] = useState(session.room?.id ?? "");
  const [capacity, setCapacity] = useState(String(session.capacity));
  const [submitted, setSubmitted] = useState(false);
  const capacityValue = wholeNumber(capacity);
  const capacityError =
    capacityValue === null || capacityValue < 1 || capacityValue > 500
      ? "בין 1 ל־500"
      : capacityValue < session.bookedCount
        ? `כבר רשומים ${session.bookedCount}`
        : null;

  const update = useMutation({
    mutationKey: [organizationId, "schedule.update"],
    mutationFn: (body: Schemas["UpdateSessionRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/sessions/{sessionId}", {
          params: { path: { organizationId, sessionId: session.id }, header: { "If-Match": session.version } },
          body,
        }),
      ),
    onSuccess: async (updated) => {
      await refresh(updated);
      toast.show({ tone: "success", icon: "check", message: "השיעור נשמר" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (capacityError) return;
    const body: Schemas["UpdateSessionRequest"] = {};
    if (instructorId !== (session.instructor?.membershipId ?? "")) body.instructorMembershipId = instructorId || null;
    if (roomId !== (session.room?.id ?? "")) body.roomId = roomId || null;
    if (capacityValue !== session.capacity) body.capacity = capacityValue!;
    if (Object.keys(body).length === 0) onClose();
    else update.mutate(body);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="עריכת השיעור"
      description="השינוי חל רק על השיעור הזה. הגדלת מספר המקומות מכניסה ממתינים לפי הסדר."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="edit-session" loading={update.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="edit-session" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="מדריך.ה">
          <Select value={instructorId} onChange={(event) => setInstructorId(event.target.value)}>
            <option value="">בלי מדריך</option>
            {/* The current instructor stays listed even if they left the team. */}
            {session.instructor && !instructors.data?.some((item) => item.id === session.instructor!.membershipId) && (
              <option value={session.instructor.membershipId}>{session.instructor.displayName}</option>
            )}
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
            {session.room && !rooms.data?.some((room) => room.id === session.room!.id) && (
              <option value={session.room.id}>{session.room.name}</option>
            )}
            {(rooms.data ?? [])
              .filter((room) => room.status === "active" || room.id === session.room?.id)
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="מקומות" required error={submitted ? capacityError : undefined}>
          <Input
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            style={{ maxWidth: 120 }}
          />
        </Field>
        {update.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(update.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function CancelSessionDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const { organizationId } = useStudio();
  const refresh = useRefreshSession(session);
  const cancel = useMutation({
    mutationKey: [organizationId, "schedule.cancel"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/sessions/{sessionId}/cancel", {
          params: { path: { organizationId, sessionId: session.id } },
        }),
      ),
    onSuccess: async (updated) => {
      await refresh(updated);
      toast.show({ tone: "success", icon: "check", message: "השיעור בוטל והמתאמנים קיבלו הודעה" });
      onClose();
    },
  });
  const people = session.bookedCount + session.waitlistCount;

  return (
    <Dialog
      open
      onClose={onClose}
      title="לבטל את השיעור?"
      description={
        people === 0
          ? "אין רשומים לשיעור. אי אפשר לבטל את הפעולה."
          : `${session.bookedCount} הרשומים ו־${session.waitlistCount} הממתינים יקבלו הודעה, וכניסות מכרטיסייה יוחזרו להם. אי אפשר לבטל את הפעולה.`
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארת השיעור
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            ביטול השיעור
          </Button>
        </>
      }
    >
      {cancel.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(cancel.error, "לא הצלחנו לבטל את השיעור. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}
