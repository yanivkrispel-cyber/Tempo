import { createContext, useContext } from "react";
import type { MyMembership } from "../../account/account";

/** The studio the console shows, from the URL's slug and the caller's membership in it. */
export interface Studio {
  organizationId: string;
  slug: string;
  displayName: string;
  membership: MyMembership;
  /** From GET /me (or the role's Phase 1 set): the apps show or hide actions with it; the API decides. */
  can: (permission: string) => boolean;
}

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("useStudio needs <ConsoleLayout> above it");
  return studio;
}
