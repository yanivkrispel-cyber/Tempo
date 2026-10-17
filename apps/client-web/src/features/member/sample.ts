// Sample data for the one part of the member screens the studio API does not serve yet: the health declaration on
// the profile (docs/31, built in H2). The timetable, bookings, passes and progress are real (studio.ts, progress.ts).
import type { IsoDate } from "../../shared/utilities/dates";

export interface MemberProfile {
  healthDeclarationSigned: boolean;
}

function sampleProfile(): MemberProfile {
  return {
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
