import { createContext, useContext } from "react";

// A studio's own installable app (docs/35 section 5, W-4): `/s/<slug>/` is the member app locked to one studio, with
// that studio's manifest, icon and name. The plain `/` stays the generic Tempo app with a studio switcher (W-5).

/** A slug as the API writes it: lowercase Latin letters, digits and hyphens, 3 to 40 characters. */
const studioPathPattern = /^\/s\/([a-z0-9-]{3,40})(?:\/|$)/;

/** The studio a path names, or null for the generic app. */
export function studioSlugOf(pathname: string): string | null {
  return studioPathPattern.exec(pathname)?.[1] ?? null;
}

/** The router's basename for a studio's own app. */
export const studioBasename = (slug: string) => `/s/${slug}`;

/** Loads a studio's own app at `path`: it runs under its own basename, so a router outside it cannot go there. */
export function openStudioApp(path: string): void {
  window.location.replace(path);
}

const StudioPathContext = createContext<string | null>(null);

export const StudioPathProvider = StudioPathContext.Provider;

/** The slug of the studio's own app this page runs as, or null in the generic app. */
export function useStudioPath(): string | null {
  return useContext(StudioPathContext);
}

const generic = { manifest: "/manifest.webmanifest", icon: "/apple-touch-icon.png", title: "Tempo" } as const;

/** The public API base of one studio: its manifest, icons and public page (docs/35 W-6, docs/37). */
export const publicStudioUrl = (apiUrl: string, slug: string) =>
  `${apiUrl}/api/v1/public/studios/${encodeURIComponent(slug)}`;

/**
 * Points the page's manifest and home-screen icon at the studio's own, before the first render, so Chrome's install
 * and iPhone's Add to Home Screen read them (W-6). The manifest is on the API's origin, hence `crossorigin`.
 */
export function dressStudioHead(apiUrl: string, slug: string, head: HTMLElement = document.head): void {
  const base = publicStudioUrl(apiUrl, slug);
  setLink(head, "manifest", `${base}/manifest.webmanifest`, true);
  setLink(head, "apple-touch-icon", `${base}/icons/180`);
}

/** Back to Tempo's own manifest, icon and name: the studio is unknown, suspended or removed (W-6). */
export function undressStudioHead(head: HTMLElement = document.head): void {
  setLink(head, "manifest", generic.manifest);
  setLink(head, "apple-touch-icon", generic.icon);
  setAppTitle(generic.title, head);
}

/** The page title and the name iPhone suggests for the home-screen icon. */
export function setAppTitle(name: string, head: HTMLElement = document.head): void {
  head.ownerDocument.title = name;
  head.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", name);
}

function setLink(head: HTMLElement, rel: string, href: string, crossOrigin = false): void {
  let link = head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = head.ownerDocument.createElement("link");
    link.rel = rel;
    head.append(link);
  }
  if (crossOrigin) link.crossOrigin = "anonymous";
  else link.removeAttribute("crossorigin");
  link.href = href;
}
