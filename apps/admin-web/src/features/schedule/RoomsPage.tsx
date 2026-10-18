import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Segmented,
  Skeleton,
  TableScroll,
  useToast,
} from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { scheduleKeys, useRooms, wholeNumber, type Room } from "./queries";
import { RoomLayoutDialog } from "./RoomLayoutDialog";

/** `/o/:slug/rooms`: the studio's rooms and how many people each holds (docs/29 section 3). */
export function RoomsPage() {
  const studio = useStudio();
  const rooms = useRooms();
  const [show, setShow] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [mapping, setMapping] = useState<Room | null>(null);
  const manage = studio.can("schedule.manage");
  const rows = (rooms.data ?? []).filter((room) => room.status === show);

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">לוח שיעורים</span>
          <h1>חדרים</h1>
        </div>
        {manage && (
          <Button icon="plus" onClick={() => setEditing("new")}>
            חדר חדש
          </Button>
        )}
      </header>

      <Segmented
        label="אילו חדרים"
        value={show}
        onChange={setShow}
        options={[
          { value: "active", label: "פעילים" },
          { value: "archived", label: "בארכיון" },
        ]}
      />

      {rooms.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(rooms.error, "לא הצלחנו לטעון את החדרים. נסו שוב.")}
        </Banner>
      ) : !rooms.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את החדרים…</span>
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="home" title={show === "archived" ? "אין חדרים בארכיון." : "עוד אין חדרים."}>
          {show === "active" ? "חדר קובע כמה מקומות יש בשיעור כברירת מחדל. אפשר גם בלי חדרים." : undefined}
        </EmptyState>
      ) : (
        <TableScroll label="חדרים">
          <table className="tp-table tp-table--stack">
            <caption className="tp-sr-only">חדרים</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">מקומות</th>
                {manage && (
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((room) => (
                <tr key={room.id}>
                  <td>{room.name}</td>
                  <td data-label="מקומות" className="tp-num">
                    {room.defaultCapacity}
                  </td>
                  {manage && (
                    <td className="tp-table__actions" style={{ textAlign: "end" }}>
                      <span className="tp-row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        {room.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="home"
                            onClick={() => setMapping(room)}
                            aria-label={`מפת החדר ${room.name}`}
                          >
                            מפת החדר
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(room)}
                          aria-label={`עריכת ${room.name}`}
                        >
                          עריכה
                        </Button>
                        <ArchiveButton room={room} />
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {mapping && <RoomLayoutDialog room={mapping} onClose={() => setMapping(null)} />}
      {editing && (
        <RoomDialog
          room={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(room) => setMapping(room)}
        />
      )}
    </>
  );
}

function usePatchRoom(room: Room) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return useMutation({
    mutationKey: [organizationId, "schedule.patchRoom"],
    mutationFn: (body: Schemas["UpdateRoomRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/rooms/{roomId}", {
          params: { path: { organizationId, roomId: room.id }, header: { "If-Match": room.version } },
          body,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) }),
  });
}

/** Archiving keeps the room on past and booked sessions; it only leaves the pickers. */
function ArchiveButton({ room }: { room: Room }) {
  const patch = usePatchRoom(room);
  const toast = useToast();
  const archived = room.status === "archived";
  return (
    <Button
      variant={archived ? "ghost" : "ghost-danger"}
      size="sm"
      loading={patch.isPending}
      aria-label={archived ? `החזרת ${room.name} מהארכיון` : `העברת ${room.name} לארכיון`}
      onClick={() =>
        patch.mutate(
          { status: archived ? "active" : "archived" },
          {
            onSuccess: () =>
              toast.show({
                tone: "success",
                icon: "check",
                message: archived ? "החדר חזר לרשימה" : "החדר עבר לארכיון",
              }),
            onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
          },
        )
      }
    >
      {archived ? "החזרה" : "לארכיון"}
    </Button>
  );
}

/** A new room goes straight on to its map (D20), so spot selection is the path of least effort. */
function RoomDialog({
  room,
  onClose,
  onCreated,
}: {
  room: Room | null;
  onClose: () => void;
  onCreated: (room: Room) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room ? String(room.defaultCapacity) : "");
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationKey: [organizationId, "schedule.save"],
    mutationFn: () => {
      const body = { name: name.trim(), defaultCapacity: wholeNumber(capacity) ?? 0 };
      return room
        ? unwrap(
            api.PATCH("/api/v1/organizations/{organizationId}/rooms/{roomId}", {
              params: { path: { organizationId, roomId: room.id }, header: { "If-Match": room.version } },
              body,
            }),
          )
        : unwrap(
            api.POST("/api/v1/organizations/{organizationId}/rooms", { params: { path: { organizationId } }, body }),
          );
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) });
      toast.show({ tone: "success", icon: "check", message: room ? "החדר נשמר" : "החדר נוסף" });
      onClose();
      if (!room) onCreated(saved);
    },
  });

  const capacityValue = wholeNumber(capacity);
  const nameError = name.trim() === "" ? "צריך שם" : null;
  const capacityError = capacityValue === null || capacityValue < 1 || capacityValue > 500 ? "בין 1 ל־500" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!nameError && !capacityError) save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={room ? "עריכת חדר" : "חדר חדש"}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="room" loading={save.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="room" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם" required error={submitted ? nameError : undefined}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="למשל חדר המכשירים"
          />
        </Field>
        <Field
          label="מקומות"
          required
          error={submitted ? capacityError : undefined}
          help="מספר המקומות בשיעור כברירת מחדל."
        >
          <Input
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            style={{ maxWidth: 120 }}
          />
        </Field>
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
