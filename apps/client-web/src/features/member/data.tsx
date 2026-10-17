import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { todayIso, type IsoDate } from "../../shared/utilities/dates";
import { createSampleApi, type SampleApi } from "./sample";

const SampleApiContext = createContext<SampleApi | null>(null);

/** Holds the in-memory sample API for the member screens; one per app (and per test). */
export function SampleApiProvider({ today, children }: { today?: IsoDate; children: ReactNode }) {
  const [api] = useState(() => createSampleApi(today ?? todayIso()));
  return <SampleApiContext.Provider value={api}>{children}</SampleApiContext.Provider>;
}

function useSampleApi(): SampleApi {
  const api = useContext(SampleApiContext);
  if (!api) throw new Error("The member screens need a <SampleApiProvider> above them.");
  return api;
}

/** The health declaration: sample data until the API serves it (H2). */
export function useProfile() {
  const api = useSampleApi();
  return useQuery({ queryKey: ["member", "profile"], queryFn: api.profile });
}
