import { useState } from "react";
import {
  ownSubscriptionId,
  PushPermissionDenied,
  pushSupport,
  useEnablePush,
  usePushDevices,
  useRemovePushDevice,
  useVapidKey,
} from "../../account/push";
import { errorMessage } from "../../api/errors";
import { IconButton, Toggle, useToast } from "../../shared/design-system";
import styles from "./member.module.css";

/**
 * Push on this device, and the member's other devices in this studio (docs/30 sections 4.3 and 12). The browser's
 * permission is asked only here, from the switch. Hidden while push is not set up in the environment.
 */
export function DevicePush({ organizationId }: { organizationId: string }) {
  const key = useVapidKey();
  const support = pushSupport();
  const [permission, setPermission] = useState(() =>
    support === "supported" ? Notification.permission : ("default" as NotificationPermission),
  );
  const devices = usePushDevices(organizationId, Boolean(key.data));
  const enable = useEnablePush(organizationId, key.data);
  const remove = useRemovePushDevice(organizationId);
  const toast = useToast();

  if (!key.data) return null;

  if (support === "install-first") {
    return (
      <p className="tp-caption tp-muted">
        באייפון, התראות בטלפון מגיעות רק אחרי שמוסיפים את האפליקציה למסך הבית (שיתוף ← הוספה למסך הבית).
      </p>
    );
  }
  if (support === "unsupported") {
    return <p className="tp-caption tp-muted">הדפדפן הזה לא תומך בהתראות בטלפון.</p>;
  }

  const ownId = ownSubscriptionId(organizationId);
  const items = devices.data?.items ?? [];
  const thisDeviceOn = Boolean(ownId && items.some((device) => device.id === ownId));
  const busy = enable.isPending || remove.isPending;

  const toggle = (on: boolean) => {
    if (on) {
      enable.mutate(undefined, {
        onSuccess: () => setPermission("granted"),
        onError: (error) => {
          if (error instanceof PushPermissionDenied) {
            setPermission(Notification.permission);
            return;
          }
          toast.show({
            tone: "danger",
            icon: "info",
            message: errorMessage(error, "לא הצלחנו להפעיל התראות במכשיר הזה."),
          });
        },
      });
    } else if (ownId) {
      remove.mutate(ownId, {
        onError: (error) =>
          toast.show({ tone: "danger", icon: "info", message: errorMessage(error, "לא הצלחנו לכבות. נסו שוב.") }),
      });
    }
  };

  return (
    <>
      <div className="tp-setting">
        <span className={styles.settingText} aria-hidden="true">
          <span>התראות במכשיר הזה</span>
          <span id="device-push-hint" className="tp-caption">
            {permission === "denied"
              ? "ההתראות חסומות בדפדפן. כדי לקבל אותן, אפשרו התראות לאתר הזה בהגדרות הדפדפן."
              : "בלי זה, ההודעות מגיעות רק לתיבת ההודעות באפליקציה."}
          </span>
        </span>
        <Toggle
          label="התראות במכשיר הזה"
          hideLabel
          // Why the switch is off or disabled (blocked in the browser) must reach a screen reader too.
          aria-describedby="device-push-hint"
          checked={thisDeviceOn}
          disabled={busy || devices.isPending || permission === "denied"}
          onChange={(event) => toggle(event.target.checked)}
        />
      </div>
      <hr className="tp-divider" />
      {items.length > 0 && (
        <>
          <ul className={styles.devices} aria-label="מכשירים עם התראות">
            {items.map((device) => (
              <li key={device.id} className="tp-setting">
                <span className={styles.deviceLabel}>
                  {device.deviceLabel}
                  {device.id === ownId && <span className="tp-caption tp-muted"> (המכשיר הזה)</span>}
                </span>
                <IconButton
                  icon="close"
                  label={`הסרת ${device.deviceLabel}`}
                  disabled={busy}
                  onClick={() => remove.mutate(device.id)}
                />
              </li>
            ))}
          </ul>
          <hr className="tp-divider" />
        </>
      )}
    </>
  );
}
