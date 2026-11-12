import { formatBytes, type ZipState } from "./zipDownload";

// Progress / error line and the HEIC->JPEG option for a zip download.
export default function ZipStatus({
  state,
  jpeg,
  onJpegChange,
  showHeicOption = true,
  variant = "inline",
}: {
  state: ZipState;
  jpeg: boolean;
  onJpegChange: (value: boolean) => void;
  // #254: only when the selection contains a HEIC/HEIF photo.
  showHeicOption?: boolean;
  // "row": the iPhone select bar's full-width settings row with a switch (#259).
  variant?: "inline" | "row";
}) {
  const input = (
    <input
      type="checkbox"
      role={variant === "row" ? "switch" : undefined}
      checked={jpeg}
      disabled={state.phase === "downloading"}
      onChange={(event) => onJpegChange(event.target.checked)}
    />
  );
  return (
    <span className={variant === "row" ? "zip-status zip-status--row" : "zip-status"} data-testid="zip-status">
      {showHeicOption &&
        (variant === "row" ? (
          <label className="zip-status__option zip-status__option--row">
            <span className="zip-status__option-text">HEIC as JPEG</span>
            {input}
          </label>
        ) : (
          <label className="zip-status__option">
            {input}
            HEIC as JPEG
          </label>
        ))}
      {state.phase === "downloading" &&
        (state.progress.total && !state.progress.totalUnknown ? (
          <progress
            aria-label="Download progress"
            value={Math.min(state.progress.received, state.progress.total)}
            max={state.progress.total}
          />
        ) : (
          <progress aria-label="Download progress" />
        ))}
      {state.phase === "downloading" && (
        <span role="status">
          {formatBytes(state.progress.received)}
          {state.progress.total && !state.progress.totalUnknown ? ` of about ${formatBytes(state.progress.total)}` : ""}
        </span>
      )}
      {state.phase === "started" && (
        <span role="status" title="The download is saved by your browser; it appears in its downloads when finished.">
          Download started
        </span>
      )}
      {state.phase === "error" && (
        <span role="alert" className="zip-status__error">
          {state.message}
        </span>
      )}
    </span>
  );
}
