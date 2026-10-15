// Sample data for the parts of the member screens the studio API does not serve yet: the monthly goal and the
// streak on the home screen, and the plan and the health declaration on the profile. The timetable, bookings and
// passes are real (studio.ts). Names and the plan are invented placeholders.
import { addDays, type IsoDate } from "../../shared/utilities/dates";

export interface MemberProfile {
  plan: { name: string; renewsOn: IsoDate; card: string; periodDays: number; daysLeft: number };
  visitsThisMonth: number;
  monthlyGoal: number;
  streakWeeks: number;
  healthDeclarationSigned: boolean;
}

function sampleProfile(today: IsoDate): MemberProfile {
  return {
    plan: { name: "חודשי ללא הגבלה", renewsOn: addDays(today, 5), card: "4412", periodDays: 30, daysLeft: 5 },
    visitsThisMonth: 14,
    monthlyGoal: 18,
    streakWeeks: 6,
    healthDeclarationSigned: true,
  };
}

/** An in-memory stand-in for the parts of the API that do not exist yet; async like the real one. */
export function createSampleApi(today: IsoDate) {
  return {
    today,
    profile: async (): Promise<MemberProfile> => sampleProfile(today),
  };
}

export type SampleApi = ReturnType<typeof createSampleApi>;
