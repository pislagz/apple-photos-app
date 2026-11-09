import { useEffect, useState } from "react";
import {
  ApiError,
  clearThumbnailCache,
  libraryStatus,
  pausePrewarm,
  type PrewarmStatus,
  startPrewarm,
} from "../api";

const POLL_MS = 3000;

interface Props {
  libraryId: number;
  initial: PrewarmStatus | null | undefined;
}

// Pre-warm line of the library status card: progress, start/pause, clear.
// While a job runs it re-reads the status so the bar moves.
export default function PrewarmControls({ libraryId, initial }: Props) {
  const [status, setStatus] = useState<PrewarmStatus>(initial ?? { state: "idle", total: 0, done: 0, failed: 0, note: null });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);

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
  const label = {
    idle: "Thumbnails: not pre-generated",
    running: `Thumbnails: pre-generating ${status.done} of ${status.total} (${percent}%)`,
    paused: `Thumbnails: paused at ${status.done} of ${status.total} (${percent}%)`,
    done: `Thumbnails: all ${status.total} pre-generated`,
  }[status.state];

  return (
    <li className="prewarm">
      <span>{label}</span>
      {status.state !== "idle" && <progress aria-label="Pre-warm progress" max={100} value={percent} />}
      {status.failed > 0 && <span> · {status.failed} could not be decoded</span>}
      {status.note && <span role="status"> {status.note}</span>}{" "}
      {status.state === "running" ? (
        <button type="button" disabled={busy} onClick={() => run(async () => setStatus(await pausePrewarm(libraryId)))}>
          Pause pre-warm
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => run(async () => setStatus(await startPrewarm(libraryId)))}>
          {status.state === "paused" ? "Resume pre-warm" : status.state === "done" ? "Re-run pre-warm" : "Start pre-warm"}
        </button>
      )}{" "}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!window.confirm("Delete this library's cached thumbnails? They are rebuilt on demand. The library files are not touched.")) return;
          void run(async () => {
            const result = await clearThumbnailCache(libraryId);
            setStatus(result.status);
            setMessage(`Cleared ${(result.freed_bytes / 1024 / 1024).toFixed(1)} MB of thumbnails.`);
          });
        }}
      >
        Clear thumbnail cache
      </button>
      {pollFailed && status.state === "running" && (
        <span role="status"> Couldn't refresh progress, retrying…</span>
      )}
      {message && <span role="status"> {message}</span>}
      {error && <span role="alert"> {error}</span>}
    </li>
  );
}
