import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";

// The Mac Download control (#507): one click downloads (a plain file, or one
// ZIP for 2+ items); the chevron opens "Download Unmodified Original" and,
// only where the browser can write to a folder, "Export to Folder…".
export default function DownloadMenu({
  disabled,
  ring,
  onDownload,
  onDownloadUnmodified,
  onExportToFolder,
  size = 16,
}: {
  disabled?: boolean;
  // Replaces the icon while a download runs (the toolbar ring).
  ring?: ReactNode;
  onDownload: () => void;
  onDownloadUnmodified: () => void;
  // Omitted where showDirectoryPicker does not exist.
  onExportToFolder?: () => void;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const chevronRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      chevronRef.current?.focus();
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <span className="download-menu" ref={rootRef} data-testid="download-menu">
      <button type="button" className="toolbar-button download-menu__main" aria-label="Download" title="Download" disabled={disabled} onClick={onDownload}>
        {ring ?? <Icon name="download" size={size} />}
      </button>
      <button
        type="button"
        ref={chevronRef}
        className="toolbar-button download-menu__chevron"
        aria-label="More Download Options"
        title="More Download Options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevron" size={10} className="download-menu__chevron-icon" />
      </button>
      {open && (
        <div className="download-menu__popup" role="menu" aria-label="Download options">
          <button type="button" role="menuitem" onClick={() => pick(onDownloadUnmodified)}>
            Download Unmodified Original
          </button>
          {onExportToFolder && (
            <button type="button" role="menuitem" onClick={() => pick(onExportToFolder)}>
              Export to Folder…
            </button>
          )}
        </div>
      )}
    </span>
  );
}
