import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  Dialog,
  Field,
  Skeleton,
  Textarea,
  useToast,
} from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type PersonDetail = Schemas["PersonDetail"];
type Note = Schemas["PersonNote"];

export const NOTE_MAX = 1000;

const authorRoles: Record<string, string> = { owner: "בעלים", admin: "ניהול", staff: "צוות" };

/**
 * Staff notes on a person (docs/34 section 8): plain text, newest first, with `people.notes.view`. A note is added
 * with `people.notes.manage`; its author deletes it, and `people.notes.moderate` deletes anyone's. No editing: a wrong
 * note is deleted and written again. The box says what never goes here (health) and that the person gets the notes in
 * their data export.
 */
export function NotesSection({ person }: { person: PersonDetail }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const { organizationId } = studio;
  const key = ["studio", organizationId, "person", person.id, "notes"] as const;
  const notes = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/notes", {
          params: { path: { organizationId, personId: person.id }, query: { limit: 20, before: pageParam ?? undefined } },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null,
  });
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const writable = studio.can("people.notes.manage") && (person.status === "active" || person.status === "archived");
  const canDelete = (note: Note) =>
    note.mine ? studio.can("people.notes.manage") : studio.can("people.notes.moderate");

  const [text, setText] = useState("");
  const [empty, setEmpty] = useState(false);
  const add = useMutation({
    mutationFn: (body: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/notes", {
          params: { path: { organizationId, personId: person.id } },
          body: { body },
        }),
      ),
    onSuccess: () => {
      setText("");
      toast.show({ tone: "success", icon: "check", message: "ההערה נשמרה" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const [deleting, setDeleting] = useState<Note | null>(null);
  const remove = useMutation({
    mutationFn: (note: Note) =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/people/{personId}/notes/{noteId}", {
          params: { path: { organizationId, personId: person.id, noteId: note.id } },
        }),
      ),
    onSuccess: () => {
      setDeleting(null);
      toast.show({ tone: "success", icon: "check", message: "ההערה נמחקה" });
    },
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    setEmpty(body === "");
    if (body !== "") add.mutate(body);
  };

  return (
    <Card as="section" aria-labelledby="notes" className="tp-stack">
      <h2 id="notes">הערות צוות</h2>
      {writable && (
        <form className="tp-stack" onSubmit={submit} noValidate>
          <Field
            label="הערה חדשה"
            error={empty ? "כתבו את ההערה." : undefined}
            help="לא כותבים כאן מידע רפואי: הוא נשמר רק בהצהרת הבריאות. מי שההערה עליו מקבל אותה כשהוא מבקש עותק של הנתונים שלו."
          >
            <Textarea
              value={text}
              rows={3}
              maxLength={NOTE_MAX}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          {add.isError && (
            <Banner tone="danger" icon="info">
              {errorMessage(add.error, "ההערה לא נשמרה. נסו שוב.")}
            </Banner>
          )}
          <div className="tp-row" style={{ justifyContent: "space-between" }}>
            <Button type="submit" icon="plus" loading={add.isPending}>
              שמירת ההערה
            </Button>
            <span className="tp-caption tp-muted tp-num" aria-live="polite">
              {text.length > NOTE_MAX - 100 ? `${(NOTE_MAX - text.length).toLocaleString("he-IL")} תווים נשארו` : ""}
            </span>
          </div>
        </form>
      )}

      {notes.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(notes.error, "לא הצלחנו לטעון את ההערות. נסו שוב.")}
        </Banner>
      ) : !notes.data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">טוענים את ההערות…</span>
          <Skeleton height={64} />
        </div>
      ) : items.length === 0 ? (
        <p className="tp-muted">אין הערות.</p>
      ) : (
        <ul className="tp-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 10 }} aria-label="הערות">
          {items.map((note) => (
            <li key={note.id} className="tp-card tp-card--sm tp-card--cream tp-stack" style={{ gap: 6 }}>
              <p dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {note.body}
              </p>
              <div className="tp-row" style={{ justifyContent: "space-between" }}>
                <span className="tp-caption tp-muted">
                  {note.authorName ?? authorRoles[note.authorRole] ?? "צוות"} ·{" "}
                  <span className="tp-num">{formatDate(toIsoDate(new Date(note.createdAt)))}</span>
                </span>
                {canDelete(note) && (
                  <Button variant="ghost-danger" size="sm" onClick={() => setDeleting(note)}>
                    מחיקה
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notes.hasNextPage && (
        <div>
          <Button variant="secondary" loading={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()}>
            הערות קודמות
          </Button>
        </div>
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="למחוק את ההערה?"
        description="אי אפשר לשחזר הערה שנמחקה."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              ביטול
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              מחיקת ההערה
            </Button>
          </>
        }
      />
    </Card>
  );
}
