import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Checkbox,
  DateInput,
  Dialog,
  Field,
  Input,
  Select,
  TimeInput,
  useToast,
} from "../../shared/design-system";
import { dayOfWeek, type IsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import {
  memberName,
  scheduleKeys,
  useClassTypes,
  useInstructors,
  useRooms,
  weekdayNames,
  wholeNumber,
} from "./queries";

/**
 * "שיעור חדש": a weekly class (a template, whose sessions appear for eight weeks) or a one-off session
 * (docs/29 section 4.1). Times are the studio's wall clock; the API turns them into instants.
 */
export function NewClassDialog({ day, today, onClose }: { day: IsoDate; today: IsoDate; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const classTypes = useClassTypes();
  const rooms = useRooms();
  const instructors = useInstructors();
  const activeTypes = (classTypes.data ?? []).filter((classType) => classType.status === "active");
  const activeRooms = (rooms.data ?? []).filter((room) => room.status === "active");

  const [classTypeId, setClassTypeId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState<IsoDate | null>(day < today ? today : day);
  const [start, setStart] = useState<string | null>(null);
  // null until typed: the class type's length and the room's size fill them in.
  const [minutes, setMinutes] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<string | null>(null);
  const [weekly, setWeekly] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  // The first active type until one is picked; its length until one is typed.
  const classType = activeTypes.find((item) => item.id === classTypeId) ?? activeTypes[0];
  const room = activeRooms.find((item) => item.id === roomId);
  const minutesText = minutes ?? String(classType?.defaultMinutes ?? "");
  const capacityText = capacity ?? (room ? String(room.defaultCapacity) : "");

  const minutesValue = wholeNumber(minutesText);
  const capacityValue = wholeNumber(capacityText);
  const errors = {
    classType: classType ? null : "בחרו סוג שיעור",
    date: date === null ? "בחרו תאריך" : date < today ? "התאריך כבר עבר" : null,
    start: start === null ? "בחרו שעה" : null,
    minutes: minutesValue === null || minutesValue < 10 || minutesValue > 300 ? "בין 10 ל־300 דקות" : null,
    capacity: capacityValue === null || capacityValue < 1 || capacityValue > 500 ? "בין 1 ל־500" : null,
  };

  const create = useMutation({
    mutationFn: async () => {
      const common = {
        classTypeId: classType!.id,
        localStart: start!,
        minutes: minutesValue!,
        capacity: capacityValue!,
        ...(instructorId ? { instructorMembershipId: instructorId } : {}),
        ...(roomId ? { roomId } : {}),
      };
      const path = { params: { path: { organizationId } } };
      if (weekly) {
        await unwrap(
          api.POST("/api/v1/organizations/{organizationId}/schedule-templates", {
            ...path,
            body: { ...common, weekday: dayOfWeek(date!), validFrom: date! },
          }),
        );
      } else {
        await unwrap(
          api.POST("/api/v1/organizations/{organizationId}/sessions", {
            ...path,
            body: { ...common, localDate: date! },
          }),
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) });
      toast.show({ tone: "success", icon: "check", message: "השיעור נוצר ונפתח להרשמה" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).every((error) => error === null)) create.mutate();
  };
  const shownError = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  return (
    <Dialog
      open
      onClose={onClose}
      title="שיעור חדש"
      description="השיעור יופיע מיד באפליקציה של המתאמנים."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="new-class" loading={create.isPending} disabled={activeTypes.length === 0}>
            יצירת השיעור
          </Button>
        </>
      }
    >
      <form id="new-class" className="tp-stack" onSubmit={submit} noValidate>
        {classTypes.data && activeTypes.length === 0 && (
          <Banner tone="info" icon="info">
            קודם צריך להוסיף סוג שיעור, בעמוד סוגי השיעורים.
          </Banner>
        )}
        <Field label="סוג שיעור" required error={shownError("classType")}>
          <Select value={classType?.id ?? ""} onChange={(event) => setClassTypeId(event.target.value)}>
            {activeTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
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
              {activeRooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field
            label="תאריך"
            required
            error={shownError("date")}
            help={weekly && date ? `כל יום ${weekdayNames[dayOfWeek(date)]}, החל מהתאריך הזה` : undefined}
          >
            <DateInput value={date} onChange={setDate} min={today} today={today} />
          </Field>
          <Field label="שעת התחלה" required error={shownError("start")}>
            <TimeInput value={start} onChange={setStart} step={15} />
          </Field>
        </div>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="משך בדקות" required error={shownError("minutes")}>
            <Input
              inputMode="numeric"
              value={minutesText}
              onChange={(event) => setMinutes(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
          <Field
            label="מקומות"
            required
            error={shownError("capacity")}
            help={room ? `${room.name} מחזיק עד ${room.defaultCapacity} מתאמנים.` : undefined}
          >
            <Input
              inputMode="numeric"
              value={capacityText}
              onChange={(event) => setCapacity(event.target.value)}
              style={{ maxWidth: 120 }}
            />
          </Field>
        </div>
        <Checkbox label="שיעור קבוע בכל שבוע" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
        {create.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(create.error, "לא הצלחנו ליצור את השיעור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
