import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusScope } from "../viewer/focusScope";
import type { UnconvertedFile } from "./zipDownload";

const MAX_NAMES = 20;

// D50: a HEIC-as-JPEG zip finished, but these files could not be converted
// and went into it as originals.
export default function HeicFallbackModal({
  files,
  onDownloadOriginals,
  onClose,
}: {
  files: UnconvertedFile[];
  onDownloadOriginals: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);
  useFocusScope(rootRef, { initialFocus: () => okRef.current });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const shown = files.slice(0, MAX_NAMES).map((file) => file.name);
  const more = files.length - shown.length;
  return createPortal(
    <div className="heic-fallback" ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="heic-fallback-title">
      <div className="heic-fallback__card">
        <p id="heic-fallback-title" data-testid="heic-fallback-text">
          These {files.length} {files.length === 1 ? "file" : "files"} stayed HEIC: {shown.join(", ")}
          {more > 0 ? ` and ${more} more` : ""}
        </p>
        <div className="heic-fallback__buttons">
          <button type="button" onClick={onDownloadOriginals}>
            Download originals of these
          </button>
          <button type="button" ref={okRef} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
