import { useSyncExternalStore } from "react";

/**
 * Installing the console from inside it (board #347, P-3), from a row in the settings. Chrome, Edge and Samsung
 * Internet fire `beforeinstallprompt` when the app may be installed; it is kept here, so the console asks only when
 * someone chooses to, never on the first visit. Safari on an iPhone has no prompt; the console shows the steps
 * instead. Nothing is offered when the app already runs installed. The same as client-web's `app/install.ts`,
 * without the home card's dismissal.
 */

/** The browser's install prompt; not in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** How this browser installs the app: its own prompt, the iPhone steps, or not at all. */
export type InstallWay = "prompt" | "ios" | null;

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const listening = new WeakSet<Window>();
const notify = () => listeners.forEach((listener) => listener());

/** Call once, before the first render: the event can fire before any screen mounts. */
export function listenForInstall(target: Window = window): void {
  if (listening.has(target)) return;
  listening.add(target);
  target.addEventListener("beforeinstallprompt", (event) => {
    // Chrome's own install banner would otherwise show on the first visit.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function isStandalone(): boolean {
  const standalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An iPhone or iPad, including an iPad that says it is a Mac. */
export function isIos(): boolean {
  const agent = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
}

function currentWay(): InstallWay {
  if (installed || isStandalone()) return null;
  if (deferred) return "prompt";
  return isIos() ? "ios" : null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the browser's prompt (it can be used once); the answer is the user's. */
async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return null;
  } finally {
    // Even when the browser rejects: the row then stops offering a prompt that is gone.
    notify();
  }
}

export function useInstall(): { way: InstallWay; prompt: typeof promptInstall } {
  return { way: useSyncExternalStore(subscribe, currentWay), prompt: promptInstall };
}

export function resetInstallForTests(): void {
  deferred = null;
  installed = false;
}
