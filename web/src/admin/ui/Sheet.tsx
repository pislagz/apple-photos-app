import { createPortal } from "react-dom";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

export interface SheetAction {
  label: string;
  onClick: () => void;
  /** "destructive" is the red button; use it only for the final, irreversible step. */
  kind?: "neutral" | "destructive";
  disabled?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one way to ask "are you sure?" or to ask for a short answer; replaces
 * window.confirm and window.prompt. Escape or the Cancel button closes it.
 * Focus starts on Cancel (the safe choice), stays inside, and goes back to
 * what had it before when the sheet closes.
 */
export default function Sheet({
  title,
  children,
  actions,
  onClose,
  cancelLabel = "Cancel",
}: {
  title: string;
  children?: ReactNode;
  actions: SheetAction[];
  onClose: () => void;
  cancelLabel?: string;
}) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? cancelRef.current;
    focusTarget?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="admin-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children === undefined ? undefined : bodyId}
        className="admin-sheet"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="admin-sheet__title">
          {title}
        </h2>
        {children !== undefined && (
          <div id={bodyId} className="admin-sheet__body">
            {children}
          </div>
        )}
        <div className="admin-sheet__actions">
          <button ref={cancelRef} type="button" className="admin-btn" onClick={onClose}>
            {cancelLabel}
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`admin-btn${action.kind === "destructive" ? " admin-btn--danger-fill" : " admin-btn--primary"}`}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
