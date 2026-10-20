import { useQuery } from "@tanstack/react-query";
import { TempoApiError, unwrap } from "@tempo/api-client";
import { useEffect } from "react";
import { useApi } from "../api/ApiProvider";
import { accentOfThemeColor, applyAccent } from "../shared/design-system";
import { setAppTitle, undressStudioHead } from "./studioPath";

/**
 * A studio's look as its own installable app knows it: the manifest the API serves for every active studio, public
 * and cacheable (docs/35 W-6). `short_name` is the brand's app name and `theme_color` the accent's light colour.
 */
export function useStudioManifest(slug: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["studio-manifest", slug],
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/studios/{slug}/manifest.webmanifest", { params: { path: { slug: slug ?? "" } } })),
    enabled: Boolean(slug),
    staleTime: 10 * 60_000,
    // An unknown, suspended or removed studio answers 404 and stays so.
    retry: (failures, error) => failures < 1 && !(error instanceof TempoApiError && error.status < 500),
  });
}

/** Puts the studio's accent on `<html>` once its manifest is read; sage when it names none or cannot be read. */
export function useStudioAccent(slug: string | null | undefined): void {
  const { data, isPending } = useStudioManifest(slug);
  const accent = accentOfThemeColor(data?.["theme_color"]);
  useEffect(() => {
    // Not while the next studio's manifest loads: the previous accent stays rather than flashing sage.
    if (slug && !isPending) applyAccent(accent);
  }, [slug, isPending, accent]);
}

/**
 * A studio's own app (`/s/<slug>/`): its name in the title, which iPhone's Add to Home Screen reads, and its accent,
 * on every screen including sign-in. A studio the API does not know goes back to Tempo's manifest and icon (W-6).
 */
export function StudioLook({ slug }: { slug: string }) {
  const { data, error } = useStudioManifest(slug);
  useStudioAccent(slug);
  const name = data?.["short_name"];
  const gone = error instanceof TempoApiError && error.status === 404;
  useEffect(() => {
    if (typeof name === "string" && name) setAppTitle(name);
  }, [name]);
  useEffect(() => {
    if (gone) undressStudioHead();
  }, [gone]);
  return null;
}
