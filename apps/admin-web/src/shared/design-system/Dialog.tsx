import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { focusableIn } from "./focus";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A line under the title; it becomes the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
  /** The buttons row, primary action last. */
  actions?: ReactNode;
  /** Escape and a click on the backdrop close it. Turn off for a dialog that must be answered. */
  dismissible?: boolean;
  /** What gets focus on open; by default the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * A modal dialog: a bottom sheet on phones, centred from 768px (CSS). It traps Tab, closes on
 * Escape, locks the page scroll, and gives focus back to whatever opened it.
 */
export function Dialog(props: DialogProps) {
  return props.open ? createPortal(<OpenDialog {...props} />, document.body) : null;
}

function OpenDialog({ onClose, title, description, children, actions, dismissible = true, initialFocus }: DialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? focusableIn(dialog.current)[0] ?? dialog.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [initialFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableIn(dialog.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && at <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (at === -1 || at === items.length - 1)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="tp-scrim"
      onMouseDown={(event) => {
        // mousedown, not click: a drag that starts inside the dialog and ends outside must not close it.
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="tp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="tp-dialog__handle" aria-hidden="true" />
        <h2 id={titleId} className="tp-dialog__title">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="tp-dialog__body">
            {description}
          </p>
        )}
        {children}
        {actions && <div className="tp-dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}
