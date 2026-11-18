import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusScope } from "../viewer/focusScope";
import { countLabel, type ExportState } from "./exportModel";
import ProgressRing from "./ProgressRing";
import type { useExport } from "./useExport";

type Flow = ReturnType<typeof useExport>;

// A quick export finishes before anyone could read a HUD: show it only once
// the wait is noticeable, so one fast photo is a tap and the share sheet.
export const HUD_DELAY_MS = 500;

function workingFraction(state: Extract<ExportState, { phase: "working" }>): number | null {
  return state.fileCount > 1 && state.method !== "zip" ? state.fileIndex / state.fileCount : null;
}

function workingTitle(state: Extract<ExportState, { phase: "working" }>): string {
  const noun = `${state.items.length} ${state.items.length === 1 ? "Item" : "Items"}`;
  if (state.method === "zip") return "Preparing ZIP…";
  if (state.method === "folder") return `Exporting ${noun}…`;
  return `Preparing ${noun}…`;
}

// Progress, ready, refusal and error for Share / Export / ZIP.
// "phone": the iOS system HUD -- a blurred rounded square with a ring, and
// plain text rows instead of web buttons. "desktop": progress is the ring in
// the toolbar, so only the cases that need a decision show, as a small
// macOS-style alert.
export default function TransferHud({ flow, layout }: { flow: Flow; layout: "phone" | "desktop" }) {
  const { state, close, confirmShare, retry, saveZip } = flow;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const working = state.phase === "working";
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!working) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), HUD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [working]);

  const shown = layout === "phone" ? (working ? late : state.phase !== "idle") : state.phase !== "idle" && !working;
  useFocusScope(rootRef, { active: shown, initialFocus: () => rootRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? rootRef.current });
  useEffect(() => {
    if (!shown) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shown, close]);

  if (!shown || state.phase === "idle") return null;

  const phone = layout === "phone";
  let title = "";
  let message: string | null = null;
  let hint: string | null = null;
  let glyph: "ring" | "warn" | "check" | null = null;
  const rows: { label: string; onClick: () => void; primary?: boolean; test: string }[] = [];
  const cancel = { label: phone ? "Cancel" : "Close", onClick: close, test: "transfer-cancel" };

  switch (state.phase) {
    case "working":
      title = workingTitle(state);
      glyph = "ring";
      rows.push({ ...cancel, label: "Cancel" });
      break;
    case "ready":
      title = "Ready to Share";
      message = `${state.items.length} ${state.items.length === 1 ? "item" : "items"} ready`;
      hint = state.hint ?? null;
      rows.push({ label: `Share ${countLabel(state.items.length)}`, onClick: confirmShare, primary: true, test: "transfer-share" });
      rows.push({ ...cancel, label: "Cancel" });
      break;
    case "blocked":
      title = "Too Much to Share";
      message = state.message;
      rows.push({ label: phone ? "Save as ZIP to Files" : "Download as ZIP", onClick: () => void saveZip(state.items), primary: true, test: "transfer-zip" });
      rows.push({ ...cancel, label: "Cancel" });
      break;
    case "error":
      title = state.method === "zip" ? "ZIP Failed" : state.method === "folder" ? "Export Failed" : "Couldn't Share";
      message = state.message;
      glyph = "warn";
      rows.push({ label: "Try Again", onClick: retry, primary: true, test: "transfer-retry" });
      rows.push({ ...cancel, label: "Cancel" });
      break;
    case "done":
      title = "Saved";
      message = `${state.saved} ${state.saved === 1 ? "file" : "files"} saved to “${state.folder}”.`;
      glyph = "check";
      rows.push({ label: "OK", onClick: close, primary: true, test: "transfer-ok" });
      break;
  }

  return createPortal(
    <div className={`transfer-hud transfer-hud--${layout}`} data-testid="transfer-hud" data-phase={state.phase}>
      <div
        ref={rootRef}
        className="transfer-hud__card"
        role={state.phase === "working" ? "status" : "alertdialog"}
        aria-modal={state.phase === "working" ? undefined : true}
        aria-labelledby="transfer-hud-title"
        tabIndex={-1}
      >
        {glyph === "ring" && state.phase === "working" && (
          <div className="transfer-hud__glyph">
            <ProgressRing fraction={workingFraction(state)} className="transfer-hud__ring" label="Transfer progress" />
          </div>
        )}
        {glyph === "warn" && (
          <div className="transfer-hud__glyph transfer-hud__glyph--warn" aria-hidden>
            !
          </div>
        )}
        {glyph === "check" && (
          <div className="transfer-hud__glyph transfer-hud__glyph--ok" aria-hidden>
            ✓
          </div>
        )}
        <h2 id="transfer-hud-title" className="transfer-hud__title">
          {title}
        </h2>
        {message && <p className="transfer-hud__message">{message}</p>}
        {state.phase === "working" && state.fileCount > 1 && state.method !== "zip" && (
          <p className="transfer-hud__message" aria-hidden>
            {Math.min(state.fileIndex + 1, state.fileCount)} of {state.fileCount}
          </p>
        )}
        {hint && (
          <p className="transfer-hud__message" role="note">
            {hint}
          </p>
        )}
        <div className="transfer-hud__rows">
          {rows.map((row, index) => (
            <button
              key={row.test}
              type="button"
              className={`transfer-hud__row${row.primary ? " transfer-hud__row--primary" : ""}`}
              data-testid={row.test}
              data-autofocus={index === 0 ? "" : undefined}
              onClick={row.onClick}
            >
              {row.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
