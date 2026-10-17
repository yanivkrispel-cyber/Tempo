import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { Chip, type ChipTone } from "../../shared/design-system";
import { useStudio } from "../console/studio";

export type Tag = Schemas["Tag"];
export type PersonTag = Schemas["PersonTag"];

/**
 * The studio's six tag colours (docs/34 section 7, N-1) on the design system's category tones, which pass contrast.
 * A tag is never told apart by colour alone: its name is always on the chip.
 */
export const tagColors: readonly { value: number; tone: ChipTone; label: string }[] = [
  { value: 1, tone: "cat-sage", label: "ירוק" },
  { value: 2, tone: "cat-rose", label: "ורוד" },
  { value: 3, tone: "cat-taupe", label: "חום" },
  { value: 4, tone: "cat-blue", label: "כחול" },
  { value: 5, tone: "cat-amber", label: "ענבר" },
  { value: 6, tone: "cat-mauve", label: "סגול" },
];

export function tagTone(color: number): ChipTone {
  return tagColors.find((option) => option.value === color)?.tone ?? "neutral";
}

export function TagChip({ tag }: { tag: PersonTag }) {
  return <Chip tone={tagTone(tag.color)}>{tag.name}</Chip>;
}

/** The person's tags as chips, or nothing. */
export function TagChips({ tags }: { tags: readonly PersonTag[] | undefined }) {
  if (!tags?.length) return null;
  return (
    <ul className="tp-row" style={{ gap: 6, listStyle: "none", margin: 0, padding: 0 }} aria-label="תגיות">
      {tags.map((tag) => (
        <li key={tag.id}>
          <TagChip tag={tag} />
        </li>
      ))}
    </ul>
  );
}

export const tagsKey = (organizationId: string) => ["studio", organizationId, "tags"] as const;

/** The studio's tags, by name (`people.view`). */
export function useTags(enabled = true) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: tagsKey(organizationId),
    enabled,
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/tags", { params: { path: { organizationId } } })).then(
        (list) => list.items,
      ),
  });
}

/** "3 אנשים", "אדם אחד", "אף אחד". */
export function peopleLabel(count: number): string {
  if (count === 0) return "אף אחד";
  return count === 1 ? "אדם אחד" : `${count.toLocaleString("he-IL")} אנשים`;
}
