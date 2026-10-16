import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ToastTone = "neutral" | "success" | "danger";

export interface ToastOptions {
  message: ReactNode;
  tone?: ToastTone;
  icon?: IconName;
  /** A toast with an action stays until it is closed, so there is time to use it (WCAG 2.2.1). */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  show: (toast: ToastOptions) => number;
  dismiss: (id: number) => void;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneIcon: Record<ToastTone, IconName> = { neutral: "info", success: "check", danger: "info" };

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it.");
  return api;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** How long a toast without an action stays, in milliseconds. */
  duration?: number;
  /** The region's accessible name. */
  label?: string;
}

/**
 * Short confirmations ("נרשמת לשיעור"). The region is always in the page and polite, so screen
 * readers announce each new toast. Errors that block the person belong in a Banner, not a toast.
 */
export function ToastProvider({ children, duration = 5000, label = "הודעות" }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const show = useCallback((toast: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <section className="tp-toast-region" aria-label={label} aria-live="polite">
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} duration={duration} dismiss={dismiss} />
          ))}
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  duration,
  dismiss,
}: {
  toast: ToastEntry;
  duration: number;
  dismiss: (id: number) => void;
}) {
  const tone = toast.tone ?? "neutral";

  useEffect(() => {
    if (toast.action || duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(toast.id), duration);
    return () => window.clearTimeout(timer);
  }, [toast, duration, dismiss]);

  return (
    <div className={cx("tp-toast", tone !== "neutral" && `tp-toast--${tone}`)}>
      <span className="tp-toast__tile">
        <Icon name={toast.icon ?? toneIcon[tone]} />
      </span>
      <span>{toast.message}</span>
      {toast.action && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <button type="button" className="tp-toast__close" aria-label="סגירה" onClick={() => dismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </div>
  );
}
