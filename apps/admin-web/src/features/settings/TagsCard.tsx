import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Dialog, IconButton, Skeleton, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { TagDialog } from "../tags/TagDialog";
import { TagChip, peopleLabel, useTags, type Tag } from "../tags/tags";

/**
 * The studio's tags (docs/34 section 7, N-1 and N-2), for `people.tags.manage`: create, rename, recolour, and delete
 * with a confirm that says how many people have the tag. Putting a tag on a person happens on the person card.
 */
export function TagsCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const tags = useTags();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const remove = useMutation({
    mutationFn: (tag: Tag) =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/tags/{tagId}", {
          params: { path: { organizationId, tagId: tag.id } },
        }),
      ),
    onSuccess: (_, tag) => {
      setDeleting(null);
      toast.show({ tone: "success", icon: "check", message: `התגית ${tag.name} נמחקה` });
    },
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId] }),
  });

  return (
    <Card as="section" id="tags" aria-labelledby="tags-title" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <h2 id="tags-title">תגיות</h2>
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setEditing("new")}>
          תגית חדשה
        </Button>
      </div>
      <p className="tp-caption tp-muted">
        תגית מסמנת קבוצה של אנשים, למשל &quot;בוקר&quot; או &quot;ייבוא 17.10&quot;, ואפשר לסנן לפיה את רשימת האנשים. עד
        100 תגיות בסטודיו ועד 20 לאדם.
      </p>
      {tags.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(tags.error, "לא הצלחנו לטעון את התגיות. נסו שוב.")}
        </Banner>
      ) : !tags.data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">טוענים את התגיות…</span>
          <Skeleton height={48} />
        </div>
      ) : tags.data.length === 0 ? (
        <p className="tp-muted">עוד אין תגיות.</p>
      ) : (
        <ul className="tp-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }} aria-label="התגיות">
          {tags.data.map((tag) => (
            <li key={tag.id} className="tp-row" style={{ justifyContent: "space-between" }}>
              <span className="tp-row" style={{ gap: 10 }}>
                <TagChip tag={tag} />
                <span className="tp-caption tp-muted">{peopleLabel(tag.peopleCount)}</span>
              </span>
              <span className="tp-row" style={{ gap: 4 }}>
                <IconButton icon="edit" size="sm" label={`עריכת התגית ${tag.name}`} onClick={() => setEditing(tag)} />
                <IconButton icon="close" size="sm" label={`מחיקת התגית ${tag.name}`} onClick={() => setDeleting(tag)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && <TagDialog tag={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `למחוק את התגית ${deleting.name}?` : ""}
        description={
          deleting === null
            ? undefined
            : deleting.peopleCount === 0
              ? "אף אחד לא מסומן בה."
              : deleting.peopleCount === 1
                ? "היא מסומנת אצל אדם אחד, ותוסר ממנו."
                : `היא מסומנת אצל ${peopleLabel(deleting.peopleCount)}, ותוסר מכולם.`
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              ביטול
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              מחיקת התגית
            </Button>
          </>
        }
      />
    </Card>
  );
}
