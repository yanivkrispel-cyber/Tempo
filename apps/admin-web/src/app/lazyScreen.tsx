import { lazy, type ComponentType, type LazyExoticComponent } from "react";
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
export function preloadScreen(routes: RouteObject[], pathname: string) {
  for (const match of matchRoutes(routes, pathname) ?? []) {
    (match.route.handle as ScreenHandle | undefined)?.preload().catch(() => undefined);
  }
}

/**
 * While a screen's chunk loads: the account's loading placeholder, so the two read as one wait. Inside the console the
 * frame is already there, so only the page's part is a placeholder.
 */
export function ScreenSkeleton({ inConsole = false }: { inConsole?: boolean }) {
  const content = (
    <>
      <span className="tp-sr-only">טוענים…</span>
      <Skeleton height={56} />
      <Skeleton height={240} />
    </>
  );
  return inConsole ? (
    <div className="tp-stack" aria-busy="true">
      {content}
    </div>
  ) : (
    <main className="tp-page tp-stack" aria-busy="true">
      {content}
    </main>
  );
}
