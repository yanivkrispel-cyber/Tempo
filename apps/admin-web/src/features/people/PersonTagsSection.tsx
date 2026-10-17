import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Button, Card, Field, IconButton, Select, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { TagChip, useTags, type PersonTag } from "../tags/tags";

type PersonDetail = Schemas["PersonDetail"];

/**
 * The person's tags (docs/34 section 7): chips for whoever sees the person, put on and taken off with `people.manage`.
 * The studio's tag list itself is managed in the settings (`people.tags.manage`).
 */
export function PersonTagsSection({ person, writable }: { person: PersonDetail; writable: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const { organizationId } = studio;
  const tags = useTags(writable);
  const [choice, setChoice] = useState("");
  const current = person.tags ?? [];
  const available = (tags.data ?? []).filter((tag) => !current.some((mine) => mine.id === tag.id));
  // The card, the people list and each tag's count all change.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId] });

  const path = (tagId: string) => ({ params: { path: { organizationId, personId: person.id, tagId } } });
  const add = useMutation({
    mutationFn: (tagId: string) =>
      unwrap(api.POST("/api/v1/organizations/{organizationId}/people/{personId}/tags/{tagId}", path(tagId))),
    onSuccess: () => setChoice(""),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (tag: PersonTag) =>
      unwrap(api.DELETE("/api/v1/organizations/{organizationId}/people/{personId}/tags/{tagId}", path(tag.id))),
    onSuccess: (_, tag) => toast.show({ tone: "success", icon: "check", message: `התגית ${tag.name} הוסרה` }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: refresh,
  });

  return (
    <Card as="section" aria-labelledby="tags" className="tp-stack">
      <h2 id="tags">תגיות</h2>
      {current.length === 0 ? (
        <p className="tp-muted">אין תגיות.</p>
      ) : (
        <ul className="tp-row" style={{ gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
          {current.map((tag) => (
            <li key={tag.id} className="tp-row" style={{ gap: 2 }}>
              <TagChip tag={tag} />
              {writable && (
                <IconButton
                  icon="close"
                  size="sm"
                  label={`הסרת התגית ${tag.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(tag)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {writable &&
        (available.length > 0 ? (
          <form
            className="tp-row"
            style={{ alignItems: "flex-end" }}
            onSubmit={(event) => {
              event.preventDefault();
              if (choice) add.mutate(choice);
            }}
          >
            <Field label="הוספת תגית">
              <Select value={choice} onChange={(event) => setChoice(event.target.value)}>
                <option value="">בחירת תגית</option>
                {available.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" icon="plus" loading={add.isPending} disabled={!choice}>
              הוספה
            </Button>
          </form>
        ) : (
          tags.data && (
            <p className="tp-caption tp-muted">
              {tags.data.length === 0 ? "בסטודיו עוד אין תגיות." : "כל התגיות של הסטודיו כבר כאן."}{" "}
              {studio.can("people.tags.manage") && <Link to={`/o/${studio.slug}/settings#tags`}>לניהול התגיות</Link>}
            </p>
          )
        ))}
    </Card>
  );
}
