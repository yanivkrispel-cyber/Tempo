import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Chip, Dialog, Field, Input, Select } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { tagColors, tagTone, tagsKey, type Tag } from "./tags";

export const TAG_NAME_MAX = 30;

/**
 * A new tag, or a tag renamed or recoloured (`people.tags.manage`, docs/34 section 7). `onSaved` gets the tag as the
 * API returned it, so a caller can pick a tag it has just created (the import's batch tag, I-8).
 */
export function TagDialog({
  tag,
  initialName = "",
  onClose,
  onSaved,
}: {
  tag: Tag | null;
  initialName?: string;
  onClose: () => void;
  onSaved?: (tag: Tag) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const [name, setName] = useState(tag?.name ?? initialName);
  const [color, setColor] = useState(tag?.color ?? 1);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      tag
        ? unwrap(
            api.PATCH("/api/v1/organizations/{organizationId}/tags/{tagId}", {
              params: { path: { organizationId, tagId: tag.id }, header: { "If-Match": tag.version } },
              body: { name: name.trim(), color },
            }),
          )
        : unwrap(
            api.POST("/api/v1/organizations/{organizationId}/tags", {
              params: { path: { organizationId } },
              body: { name: name.trim(), color },
            }),
          ),
    onSuccess: (saved) => {
      // In the list at once, so a picker can select a tag made a moment ago; the refetch then confirms it.
      queryClient.setQueryData<Tag[]>(tagsKey(organizationId), (old) =>
        old
          ? [...old.filter((other) => other.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, "he"))
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: ["studio", organizationId] });
      onSaved?.(saved);
      onClose();
    },
  });
  const nameError = submitted && name.trim() === "" ? "צריך שם לתגית." : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() !== "") save.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={tag ? "עריכת תגית" : "תגית חדשה"}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="tag-form" loading={save.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="tag-form" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם" required error={nameError} help={`עד ${TAG_NAME_MAX} תווים, למשל "בוקר" או "ייבוא 17.10".`}>
          <Input value={name} maxLength={TAG_NAME_MAX} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="צבע">
          <Select value={String(color)} onChange={(event) => setColor(Number(event.target.value))}>
            {tagColors.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="tp-row" style={{ gap: 8 }}>
          <span className="tp-caption tp-muted">כך היא תיראה:</span>
          <Chip tone={tagTone(color)}>{name.trim() || "תגית"}</Chip>
        </div>
        {save.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(save.error, "התגית לא נשמרה. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
