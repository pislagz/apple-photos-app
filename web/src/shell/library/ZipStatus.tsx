import { formatBytes, type ZipState } from "./zipDownload";

// Progress / error line and the HEIC->JPEG option for a zip download.
export default function ZipStatus({
  state,
  jpeg,
  onJpegChange,
}: {
  state: ZipState;
  jpeg: boolean;
  onJpegChange: (value: boolean) => void;
}) {
  return (
    <span className="zip-status" data-testid="zip-status">
      <label className="zip-status__option">
        <input
          type="checkbox"
          checked={jpeg}
          disabled={state.phase === "downloading"}
          onChange={(event) => onJpegChange(event.target.checked)}
        />
        HEIC as JPEG
      </label>
      {state.phase === "downloading" &&
        (state.progress.total && !state.progress.totalUnknown ? (
          <progress
            aria-label="Zip download progress"
            value={Math.min(state.progress.received, state.progress.total)}
            max={state.progress.total}
          />
        ) : (
          <progress aria-label="Zip download progress" />
        ))}
      {state.phase === "downloading" && (
        <span role="status">
          {formatBytes(state.progress.received)}
          {state.progress.total && !state.progress.totalUnknown ? ` of about ${formatBytes(state.progress.total)}` : ""}
        </span>
      )}
      {state.phase === "started" && (
        <span role="status" title="The zip is saved by your browser; it appears in its downloads when finished.">
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
