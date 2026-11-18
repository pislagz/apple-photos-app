import { formatBytes, type ZipState } from "./zipDownload";

// Mac toolbar status for a ZIP download (#507). Progress is the ring on the
// Download button (ZipRing), so this carries screen-reader text and the one
// failure line with its retry.
export default function ZipStatus({
  state,
  onRetry,
  onDismiss,
}: {
  state: ZipState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.phase === "idle") return null;
  return (
    <span className="zip-status zip-status--toolbar" data-testid="zip-status">
      {state.phase === "downloading" && (
        <span role="status" className="sr-only">
          {formatBytes(state.progress.received)}
          {state.progress.total && !state.progress.totalUnknown ? ` of about ${formatBytes(state.progress.total)}` : ""}
        </span>
      )}
      {state.phase === "started" && (
        <span role="status" className="sr-only">
          Download started
        </span>
      )}
      {state.phase === "error" && (
        <>
          <span role="alert" className="zip-status__error" title={state.message}>
            {state.message}
          </span>
          <button type="button" className="zip-status__retry" onClick={onRetry}>
            {state.retryLabel ?? "Try Again"}
          </button>
          <button type="button" className="zip-status__retry" onClick={onDismiss}>
            Dismiss
          </button>
        </>
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
