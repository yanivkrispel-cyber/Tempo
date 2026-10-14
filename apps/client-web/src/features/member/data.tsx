import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { todayIso, type IsoDate } from "../../shared/utilities/dates";
import { createSampleApi, type Booking, type SampleApi, type StudioClass } from "./sample";

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

export const useToday = () => useSampleApi().today;

export function useClasses() {
  const api = useSampleApi();
  return useQuery({ queryKey: ["member", "classes"], queryFn: api.classes });
}

export function useBookings() {
  const api = useSampleApi();
  return useQuery({ queryKey: ["member", "bookings"], queryFn: api.bookings });
}

export function useHistory() {
  const api = useSampleApi();
  return useQuery({ queryKey: ["member", "history"], queryFn: api.history });
}

export function useProfile() {
  const api = useSampleApi();
  return useQuery({ queryKey: ["member", "profile"], queryFn: api.profile });
}

function useMemberMutation<T>(mutationFn: (classId: string) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["member"] })
  });
}

export function useBook() {
  return useMemberMutation(useSampleApi().book);
}

export function useJoinWaitlist() {
  return useMemberMutation(useSampleApi().joinWaitlist);
}

/** The member's booking for a class, if any. */
export function bookingFor(bookings: readonly Booking[] | undefined, classId: string): Booking | undefined {
  return bookings?.find((booking) => booking.classId === classId);
}

export function freeSpots(item: StudioClass): number {
  return Math.max(item.capacity - item.booked, 0);
}

/** "נשארו 3 מקומות", "נשאר מקום אחד", "מלא · 2 בהמתנה". */
export function spotsText(item: StudioClass): string {
  const free = freeSpots(item);
  if (free === 0) return item.waiting === 0 ? "מלא" : `מלא · ${item.waiting} בהמתנה`;
  return free === 1 ? "נשאר מקום אחד" : `נשארו ${free} מקומות`;
}
