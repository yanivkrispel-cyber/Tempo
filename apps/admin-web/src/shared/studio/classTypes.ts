import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "../../features/console/studio";

export type ClassType = Schemas["ClassType"];

/** Under the schedule's keys, so a change anywhere in the schedule refreshes it. */
export const classTypesKey = (organizationId: string) => ["studio", organizationId, "schedule", "class-types"] as const;

/** The studio's class types (`schedule.view`), used by the schedule and by passes limited to one category. */
export function useClassTypes() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: classTypesKey(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/class-types", { params: { path: { organizationId } } }),
      ).then((list) => list.items),
  });
}

/** Categories studios use; the API takes lowercase English keys (`^[a-z][a-z0-9_]{1,29}$`). */
export const categoryLabels: Record<string, string> = {
  pilates: "פילאטיס",
  yoga: "יוגה",
  fitness: "כושר",
  dance: "מחול",
  other: "אחר",
};

export function categoryLabel(category: string): string {
  return categoryLabels[category] ?? category;
}

/** The known categories plus any the studio already uses. */
export function categoryOptions(inUse: readonly string[] = []): { value: string; label: string }[] {
  const keys = [...Object.keys(categoryLabels), ...inUse.filter((category) => !(category in categoryLabels))];
  return [...new Set(keys)].map((value) => ({ value, label: categoryLabel(value) }));
}
