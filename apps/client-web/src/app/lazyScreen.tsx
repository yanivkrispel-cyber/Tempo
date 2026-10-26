import { lazy, useEffect, type ComponentType, type LazyExoticComponent } from "react";
import { matchRoutes, type RouteObject } from "react-router";
import { Skeleton } from "../shared/design-system";

interface ScreenHandle {
  preload: () => Promise<unknown>;
}

/** `React.lazy` for a named export: the component loads as its own chunk the first time it renders. */
export function lazyNamed<K extends string, P extends object>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

/**
 * A route whose screen loads as its own chunk (board #511, S-3). `handle.preload` starts the download early, so the
 * first screen's chunk loads while `POST /session` runs instead of after it.
 */
export function lazyScreen<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Screen = lazyNamed(load, name);
  return { element: <Screen />, handle: { preload: load } satisfies ScreenHandle };
}

/** Starts loading the chunks of the screen at `pathname`; a failure here is retried when the screen renders. */
export function preloadScreen(routes: RouteObject[], pathname: string, basename?: string) {
  for (const match of matchRoutes(routes, pathname, basename) ?? []) {
    (match.route.handle as ScreenHandle | undefined)?.preload().catch(() => undefined);
  }
}

type Load = () => Promise<unknown>;

/** The device asked to save data, or is on a 2G connection: nothing loads ahead there (board #530, U-5). */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}

/**
 * Loads other screens' chunks once the browser is idle, so the first tap on a tab doesn't wait for its chunk (board
 * #530, O2). Render it next to the screen inside its `Suspense`: it mounts only after the screen has painted, so it
 * never competes with the screen's own chunk or reads. A failure here is retried when the screen renders.
 */
export function PrefetchScreens({ loads }: { loads: readonly Load[] }) {
  useEffect(() => {
    if (savesData()) return;
    const run = () => {
      for (const load of loads) load().catch(() => undefined);
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, [loads]);
  return null;
}

/** While a screen's chunk loads: the same placeholder as the account's loading, so the two read as one wait. */
export function ScreenSkeleton() {
  return (
    <main className="tp-page tp-stack" aria-busy="true">
      <span className="tp-sr-only">טוענים…</span>
      <Skeleton height={56} />
      <Skeleton height={240} />
    </main>
  );
}
