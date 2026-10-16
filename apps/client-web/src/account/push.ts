import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap, type TempoClient } from "@tempo/api-client";
import { useApi } from "../api/ApiProvider";

/**
 * Web push on this device (docs/30 section 4.3). The browser has one push subscription; each studio the member
 * turns push on for registers it once, and this device remembers which registrations are its own so it can remove
 * them when push is turned off or the member signs out.
 */

const storageKey = "tempo.push.subscriptions";
const workerUrl = "/sw.js";

export type PushSupport = "supported" | "unsupported" | "install-first";

/** Whether this browser can take push. iPhone and iPad can only once the app is on the home screen. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? "install-first" : "unsupported";
}

/** "Chrome, Android": what the settings page lists for this device (1-60 characters). */
export function deviceLabel(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /SamsungBrowser\//.test(userAgent)
      ? "Samsung Internet"
      : /Firefox\/|FxiOS\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "דפדפן";
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "Mac"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return system ? `${browser}, ${system}` : browser;
}

/** The VAPID public key (base64url) as the bytes `applicationServerKey` takes. */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** This device's registration per studio: organization id -> subscription id. */
function readOwn(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeOwn(own: Record<string, string>) {
  try {
    if (Object.keys(own).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(own));
  } catch {
    // Storage blocked: the server still drops the device when the push service reports it gone.
  }
}

export function ownSubscriptionId(organizationId: string): string | undefined {
  return readOwn()[organizationId];
}

async function browserSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

const keyQuery = ["push", "vapid-public-key"] as const;
const devicesKey = (organizationId: string) => ["studio", organizationId, "push-subscriptions"] as const;

/** The VAPID key, or null while push is not set up in this environment (404 `push.unavailable`). */
export function useVapidKey() {
  const api = useApi();
  return useQuery({
    queryKey: keyQuery,
    queryFn: async () => {
      try {
        return (await unwrap(api.GET("/api/v1/push/vapid-public-key"))).publicKey;
      } catch (error) {
        if (error instanceof TempoApiError && error.status === 404) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

/** The member's devices with push in this studio. */
export function usePushDevices(organizationId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: devicesKey(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/me/push-subscriptions", {
          params: { path: { organizationId } },
        }),
      ),
    enabled,
  });
}

export class PushPermissionDenied extends Error {
  constructor() {
    super("Notification permission was not granted");
  }
}

/** Turns push on for this studio on this device. Call it from a click: it may ask for the browser's permission. */
export function useEnablePush(organizationId: string, publicKey: string | null | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [organizationId, "push.subscribe"],
    mutationFn: async () => {
      if (!publicKey) throw new Error("Push is not available");
      if ((await Notification.requestPermission()) !== "granted") throw new PushPermissionDenied();
      const registration = await navigator.serviceWorker.register(workerUrl, { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = subscription.toJSON();
      const saved = await unwrap(
        api.POST("/api/v1/organizations/{organizationId}/me/push-subscriptions", {
          params: { path: { organizationId } },
          body: {
            endpoint: subscription.endpoint,
            keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
            deviceLabel: deviceLabel(),
          },
        }),
      );
      writeOwn({ ...readOwn(), [organizationId]: saved.id });
      return saved;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: devicesKey(organizationId) }),
  });
}

async function removeRegistration(api: TempoClient, organizationId: string, subscriptionId: string) {
  try {
    await unwrap(
      api.DELETE("/api/v1/organizations/{organizationId}/me/push-subscriptions/{subscriptionId}", {
        params: { path: { organizationId, subscriptionId } },
      }),
    );
  } catch (error) {
    // Already gone (404 push_subscription.not_found) is what we wanted.
    if (!(error instanceof TempoApiError && error.status === 404)) throw error;
  }
}

/**
 * Removes one of the member's devices in this studio. For this device it also forgets the registration, and
 * unsubscribes the browser once no studio uses it.
 */
export function useRemovePushDevice(organizationId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [organizationId, "push.unsubscribe"],
    mutationFn: async (subscriptionId: string) => {
      await removeRegistration(api, organizationId, subscriptionId);
      const own = readOwn();
      if (own[organizationId] !== subscriptionId) return;
      delete own[organizationId];
      writeOwn(own);
      if (Object.keys(own).length === 0) await (await browserSubscription())?.unsubscribe();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: devicesKey(organizationId) }),
  });
}

/**
 * Before signing out: removes this device's registrations and unsubscribes the browser, so the next person on a
 * shared browser does not get this member's notifications. Never blocks sign-out for more than a few seconds.
 */
export async function forgetPushOnSignOut(api: TempoClient): Promise<void> {
  const own = readOwn();
  writeOwn({});
  const work = Promise.allSettled([
    ...Object.entries(own).map(([organizationId, subscriptionId]) =>
      removeRegistration(api, organizationId, subscriptionId),
    ),
    browserSubscription().then((subscription) => subscription?.unsubscribe()),
  ]);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
}
