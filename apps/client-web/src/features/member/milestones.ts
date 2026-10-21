// The member's milestones (docs/37 section 8.2, MK8): computed live by the API and seen by her only (M-16).
import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";

export type MyMilestones = Schemas["MyMilestones"];
export type Milestone = MyMilestones["reached"][number];

export const MILESTONES: readonly Milestone[] = [10, 25, 50, 100, 200];

export function isMilestone(value: number): value is Milestone {
  return (MILESTONES as readonly number[]).includes(value);
}

/** "השיעור החמישים שלי": the card's line, in words, as she would say it. */
const ordinals: Record<Milestone, string> = {
  10: "העשירי",
  25: "העשרים וחמישה",
  50: "החמישים",
  100: "המאה",
  200: "המאתיים",
};

export function milestoneLine(count: Milestone): string {
  return `השיעור ${ordinals[count]} שלי`;
}

/** The four numbers under the line, each only when there is something to say (no instructor, no usual time). */
export function milestoneStats(milestones: MyMilestones): { value: string; label: string }[] {
  const hours = Math.round(milestones.hoursOnTheMat);
  return [
    { value: String(hours), label: hours === 1 ? "שעה על המזרן" : "שעות על המזרן" },
    milestones.longestWeekStreak > 1 ? { value: String(milestones.longestWeekStreak), label: "שבועות ברצף" } : null,
    milestones.usualTime ? { value: milestones.usualTime, label: "השעה הקבועה" } : null,
    milestones.topInstructor ? { value: milestones.topInstructor, label: "בהנחיה הכי תכופה" } : null,
  ].filter((stat): stat is { value: string; label: string } => stat !== null);
}

export function useMilestones(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["studio", organizationId, "milestones"] as const,
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/milestones", {
          params: { path: { organizationId } },
        }),
      ),
    staleTime: 60_000,
  });
}
