import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { useFocusScope } from "../viewer/focusScope";
import { formatBytes } from "../library/zipDownload";
import type { ExportCapabilities } from "./capabilities";
import { describeSelection, shareBlockReason, type ExportMethod, type ExportState } from "./exportModel";
import type { useExport } from "./useExport";

type Flow = ReturnType<typeof useExport>;

const FORMATS = [
  { value: "original", title: "Originals", detail: "As stored: HEIC photos, Live Photos with their video, and videos." },
  { value: "jpeg", title: "Compatible JPEG", detail: "HEIC photos converted to JPEG. Videos stay as they are." },
] as const;

function title(state: ExportState): string {
  switch (state.phase) {
    case "choosing":
      return "Export";
    case "working":
      return state.method === "share" ? "Preparing…" : "Exporting…";
    case "ready":
      return "Ready to share";
    case "done":
      return "Done";
    case "blocked":
      return "Too large to share";
    case "error":
      return "Export failed";
    default:
      return "";
  }
}

function methodButtons(caps: ExportCapabilities, shareBlocked: boolean) {
  const buttons: { method: ExportMethod; label: string; note?: string; disabled?: boolean }[] = [];
  if (caps.share) {
    buttons.push({ method: "share", label: "Share…", note: "Save to Photos, AirDrop, Messages…", disabled: shareBlocked });
  }
  if (caps.folder) buttons.push({ method: "folder", label: "Save to Folder…", note: "Pick a folder on this computer" });
  if (caps.individual) buttons.push({ method: "individual", label: "Download Individually", note: "One file after another" });
  return buttons;
}

export default function ExportModal({ flow }: { flow: Flow }) {
  const { state, caps, close, back, setFormat, start, confirmShare } = flow;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const open = state.phase !== "idle";
  // The second tap of a double tap on Share lands on this backdrop: it must not close the dialog it just opened.
  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = Date.now();
  }, [open]);
  useFocusScope(rootRef, { active: open, initialFocus: () => rootRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? null });

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open || !caps) return null;

  const count = "items" in state ? state.items.length : 0;
  const bytes = state.phase === "choosing" ? state.bytes : null;
  const blockedReason = state.phase === "choosing" ? shareBlockReason(count, bytes, state.format) : null;

  return createPortal(
    <div
      className="export-modal"
      data-testid="export-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && Date.now() - openedAt.current > 600) close();
      }}
    >
      <div
        ref={rootRef}
        className="export-modal__card"
        // The second tap of a double tap on Share must not press a button in the sheet that just opened.
        onClickCapture={(event) => {
          if (state.phase === "choosing" && Date.now() - openedAt.current < 500) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
        role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1}>
        <header className="export-modal__header">
          <h2 id="export-title" className="export-modal__title">
            {title(state)}
          </h2>
          <button type="button" className="export-modal__close" aria-label="Close" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </header>

        {state.phase === "choosing" && (
          <>
            <p className="export-modal__summary" data-testid="export-summary">
              {describeSelection(count, bytes)}
            </p>
            <div role="radiogroup" aria-label="What to export" className="export-modal__formats">
              {FORMATS.map((format) => (
                <label key={format.value} className="export-modal__format" data-selected={state.format === format.value}>
                  <input
                    type="radio"
                    name="export-format"
                    value={format.value}
                    checked={state.format === format.value}
                    onChange={() => setFormat(format.value)}
                  />
                  <span className="export-modal__format-text">
                    <span className="export-modal__format-title">{format.title}</span>
                    <span className="export-modal__format-detail">{format.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            {blockedReason && caps.share && (
              <p className="export-modal__warn" role="note">
                {blockedReason} Choose another method below, or turn on Download as ZIP.
              </p>
            )}
            <div className="export-modal__actions">
              {methodButtons(caps, blockedReason !== null).map((button, index) => (
                <button
                  key={button.method}
                  type="button"
                  className={index === 0 && !button.disabled ? "export-modal__action export-modal__action--primary" : "export-modal__action"}
                  data-autofocus={index === 0 ? "" : undefined}
                  disabled={button.disabled}
                  onClick={() => void start(button.method)}
                >
                  <span>{button.label}</span>
                  {button.note && <span className="export-modal__action-note">{button.note}</span>}
                </button>
              ))}
              <button type="button" className="export-modal__action export-modal__action--cancel" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "working" && (
          <>
            <p className="export-modal__summary" role="status">
              {state.method === "share" ? "Getting" : "Saving"} file {Math.min(state.fileIndex + 1, state.fileCount)} of {state.fileCount}
              {state.received > 0 ? ` · ${formatBytes(state.received)}` : ""}
            </p>
            <progress className="export-modal__progress" aria-label="Export progress" max={state.fileCount} value={state.fileIndex} />
            <div className="export-modal__actions">
              <button type="button" className="export-modal__action export-modal__action--cancel" data-autofocus onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "ready" && (
          <>
            <p className="export-modal__summary" role="status">
              {state.files.length} {state.files.length === 1 ? "file is" : "files are"} ready ({formatBytes(state.files.reduce((sum, file) => sum + file.size, 0))}).
            </p>
            {state.hint && <p className="export-modal__warn">{state.hint}</p>}
            <div className="export-modal__actions">
              <button type="button" className="export-modal__action export-modal__action--primary" data-autofocus onClick={confirmShare}>
                Share {state.items.length} {state.items.length === 1 ? "item" : "items"}
              </button>
              <button type="button" className="export-modal__action export-modal__action--cancel" onClick={close}>
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "done" && (
          <>
            <p className="export-modal__summary" role="status">
              {state.method === "folder"
                ? `Saved ${state.saved} ${state.saved === 1 ? "file" : "files"} to “${state.folder}”.`
                : `Downloaded ${state.saved} ${state.saved === 1 ? "file" : "files"}. Check your browser's downloads.`}
            </p>
            <div className="export-modal__actions">
              <button type="button" className="export-modal__action export-modal__action--primary" data-autofocus onClick={close}>
                Done
              </button>
            </div>
          </>
        )}

        {(state.phase === "blocked" || state.phase === "error") && (
          <>
            <p className="export-modal__warn" role="alert">
              {state.message}
            </p>
            {state.phase === "blocked" && (
              <p className="export-modal__summary">Go back and choose another method, or turn on Download as ZIP in {caps.standalone || caps.share ? "More" : "your account menu"}.</p>
            )}
            <div className="export-modal__actions">
              <button type="button" className="export-modal__action export-modal__action--primary" data-autofocus onClick={back}>
                {state.phase === "blocked" ? "Choose Another Method" : "Try Again"}
              </button>
              <button type="button" className="export-modal__action export-modal__action--cancel" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
