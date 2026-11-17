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
  // "toolbar": desktop title bar -- progress is a ring on the Download button (ZipRing),
  // so this only carries the HEIC option and a clipped-safe error; text is screen-reader only.
  variant?: "inline" | "row" | "toolbar";
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
    <span className={`zip-status${variant === "row" ? " zip-status--row" : ""}${variant === "toolbar" ? " zip-status--toolbar" : ""}`} data-testid="zip-status">
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
      {variant !== "toolbar" && state.phase === "downloading" &&
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
        <span role="status" className={variant === "toolbar" ? "sr-only" : undefined}>
          {formatBytes(state.progress.received)}
          {state.progress.total && !state.progress.totalUnknown ? ` of about ${formatBytes(state.progress.total)}` : ""}
        </span>
      )}
      {state.phase === "started" && (
        <span role="status" className={variant === "toolbar" ? "sr-only" : undefined} title="The download is saved by your browser; it appears in its downloads when finished.">
          Download started
        </span>
      )}
      {state.phase === "error" && (
        <span role="alert" className="zip-status__error" title={state.message}>
          {state.message}
        </span>
      )}
    </span>
  );
}

// Determinate (or spinning, when the size is unknown) ring drawn over the Download button.
export function ZipRing({ state }: { state: ZipState }) {
  if (state.phase !== "downloading") return null;
  const { received, total, totalUnknown } = state.progress;
  const known = !!total && !totalUnknown;
  const fraction = known ? Math.min(received / total, 1) : 0.25;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="zip-ring"
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(fraction * 100) : undefined}
    >
      <circle className="zip-ring__track" cx="12" cy="12" r={radius} />
      <circle
        className="zip-ring__value"
        cx="12"
        cy="12"
        r={radius}
        strokeDasharray={`${fraction * circumference} ${circumference}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
