// Sample data for the parts of the member screens the studio API does not serve yet: the monthly goal and the
// streak on the home screen, and the health declaration on the profile. The timetable, bookings and passes are
// real (studio.ts).
import type { IsoDate } from "../../shared/utilities/dates";

export interface MemberProfile {
  visitsThisMonth: number;
  monthlyGoal: number;
  streakWeeks: number;
  healthDeclarationSigned: boolean;
}

function sampleProfile(): MemberProfile {
  return {
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
    profile: async (): Promise<MemberProfile> => sampleProfile(),
  };
}

export type SampleApi = ReturnType<typeof createSampleApi>;
