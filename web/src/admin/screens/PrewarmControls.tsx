import { useEffect, useState } from "react";
import InfoButton from "../../help/InfoButton";
import {
  ApiError,
  clearThumbnailCache,
  libraryStatus,
  pausePrewarm,
  type PrewarmStatus,
  startPrewarm,
} from "../api";
import { Row } from "../ui/GroupedList";
import Sheet from "../ui/Sheet";
import { formatBytes } from "../ui/format";

const POLL_MS = 3000;

interface Props {
  libraryId: number;
  initial: PrewarmStatus | null | undefined;
  /** Size of the thumbnail cache, when the server reports it. */
  cacheBytes?: number | null;
}

// The "Thumbnails" rows of a library page: progress, prepare/pause, delete.
// While a job runs it re-reads the status so the bar moves. Put inside a GroupedList.
export default function PrewarmControls({ libraryId, initial, cacheBytes }: Props) {
  const [status, setStatus] = useState<PrewarmStatus>(initial ?? { state: "idle", total: 0, done: 0, failed: 0, note: null });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (status.state !== "running") return;
    const timer = window.setInterval(() => {
      libraryStatus(libraryId)
        .then((next) => {
          setPollFailed(false);
          if (next.prewarm) setStatus(next.prewarm);
        })
        // The interval keeps retrying; just say the bar is not live right now.
        .catch(() => setPollFailed(true));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [libraryId, status.state]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const percent = status.total === 0 ? (status.state === "done" ? 100 : 0) : Math.floor((status.done / status.total) * 100);
  const summary = {
    idle: "Not prepared yet",
    running: `Preparing ${status.done.toLocaleString()} of ${status.total.toLocaleString()} (${percent}%)`,
    paused: `Paused at ${status.done.toLocaleString()} of ${status.total.toLocaleString()} (${percent}%)`,
    done: `All ${status.total.toLocaleString()} are ready`,
  }[status.state];

  const detail = (
    <>
      {summary}
      {status.failed > 0 && ` · ${status.failed.toLocaleString()} could not be made`}
      {status.state !== "idle" && <progress aria-label="Thumbnail progress" max={100} value={percent} />}
      {status.note && <span role="status"> {status.note}</span>}
      {pollFailed && status.state === "running" && <span role="status"> Couldn't refresh progress, retrying…</span>}
      {message && <span role="status"> {message}</span>}
      {error && <span role="alert"> {error}</span>}
    </>
  );

  const primary =
    status.state === "running" ? (
      <button type="button" className="admin-btn" disabled={busy} onClick={() => run(async () => setStatus(await pausePrewarm(libraryId)))}>
        Pause
      </button>
    ) : (
      <button type="button" className="admin-btn" disabled={busy} onClick={() => run(async () => setStatus(await startPrewarm(libraryId)))}>
        {status.state === "paused" ? "Resume" : status.state === "done" ? "Prepare Again" : "Prepare Thumbnails"}
      </button>
    );

  const cacheSize = cacheBytes === null || cacheBytes === undefined || cacheBytes <= 0 ? null : formatBytes(cacheBytes);

  async function deleteCache() {
    setConfirming(false);
    await run(async () => {
      const result = await clearThumbnailCache(libraryId);
      setStatus(result.status);
      setMessage(`Deleted ${formatBytes(result.freed_bytes)} of thumbnails.`);
    });
  }

  return (
    <>
      <Row
        label={
          <>
            Thumbnails <InfoButton helpKey={status.state === "running" ? "libPause" : "libPrepare"} name="thumbnails" />
          </>
        }
        detail={detail}
        control={primary}
      />
      <Row
        label={
          <>
            Thumbnail cache <InfoButton helpKey="libDeleteCache" name="thumbnail cache" />
          </>
        }
        detail={cacheBytes === 0 ? "Empty" : (cacheSize ?? undefined)}
        control={
          <button type="button" className="admin-btn admin-btn--danger" disabled={busy} onClick={() => setConfirming(true)}>
            Delete Cache…
          </button>
        }
      />
      {confirming && (
        <Sheet
          title="Delete thumbnail cache?"
          onClose={() => setConfirming(false)}
          actions={[{ label: "Delete Cache", kind: "destructive", onClick: () => void deleteCache() }]}
        >
          <p>
            {cacheSize ? `This frees about ${cacheSize}. ` : "This frees disk space. "}
            Thumbnails are made again when someone opens the library, which can feel slower for a while. Your photos are not touched.
          </p>
        </Sheet>
      )}
    </>
  );
}
