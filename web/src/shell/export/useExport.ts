import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { getSelectionSummary } from "../../api";
import { detectExportCapabilities, pickDirectory, type DirectoryHandle } from "./capabilities";
import {
  describeExportError,
  ExportAbort,
  ExportTooLarge,
  openPlanned,
  planFiles,
  pump,
  readToFile,
  type OpenedFile,
  type PlannedFile,
} from "./exportFetch";
import {
  exportReducer,
  IDLE,
  SHARE_MAX_BYTES,
  shareBlockReason,
  uniqueName,
  type ExportFormat,
  type ExportItem,
  type ExportMethod,
} from "./exportModel";

// Only one export runs at a time, across every screen that can start one: a
// second tap (or the phone layout in a desktop browser, which mounts two
// entry points) must not stack a second sheet.
let activeOwner: symbol | null = null;

const FETCH_CONCURRENCY = 3;
const DOWNLOAD_GAP_MS = 300;
const URL_LIFETIME_MS = 30_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useExport(libraryId: number) {
  const [state, dispatch] = useReducer(exportReducer, IDLE);
  const owner = useRef(Symbol("export"));
  const abort = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const sharing = useRef(false);
  const caps = useMemo(() => (state.phase === "idle" ? null : detectExportCapabilities()), [state.phase === "idle"]);

  const release = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    if (activeOwner === owner.current) activeOwner = null;
  }, []);

  const revokeUrls = useCallback(() => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
  }, []);

  useEffect(
    () => () => {
      release();
      revokeUrls();
    },
    [release, revokeUrls],
  );

  const open = useCallback(
    (items: ExportItem[]) => {
      if (items.length === 0 || activeOwner) return;
      activeOwner = owner.current;
      sharing.current = false;
      dispatch({ type: "open", items });
      const controller = new AbortController();
      abort.current = controller;
      getSelectionSummary(libraryId, items.map((item) => item.id)).then(
        (summary) => {
          if (!controller.signal.aborted) dispatch({ type: "size", bytes: summary.total_bytes });
        },
        () => {},
      );
    },
    [libraryId],
  );

  const close = useCallback(() => {
    release();
    revokeUrls();
    dispatch({ type: "close" });
  }, [release, revokeUrls]);

  // Stops a running fetch and returns to the choice.
  const back = useCallback(() => {
    abort.current?.abort();
    abort.current = new AbortController();
    revokeUrls();
    dispatch({ type: "back" });
  }, [revokeUrls]);

  const setFormat = useCallback((format: ExportFormat) => dispatch({ type: "format", format }), []);

  const start = useCallback(
    async (method: ExportMethod) => {
      if (state.phase !== "choosing") return;
      const { items, format, bytes } = state;
      // Folder picker first, with no await before it: it needs the click's user activation.
      let folder: DirectoryHandle | null = null;
      if (method === "folder") {
        try {
          folder = await pickDirectory();
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          dispatch({ type: "error", message: describeExportError(error) });
          return;
        }
      }
      if (method === "share") {
        const reason = shareBlockReason(items.length, bytes, format);
        if (reason) {
          dispatch({ type: "blocked", message: reason });
          return;
        }
      }
      const controller = new AbortController();
      abort.current = controller;
      const { signal } = controller;
      const plan = planFiles(items, format);
      dispatch({ type: "start", method, fileCount: plan.length });
      let received = 0;
      let finished = 0;
      const progress = () => dispatch({ type: "progress", fileIndex: finished, received });
      const onBytes = (n: number) => {
        received += n;
        if (method === "share" && received > SHARE_MAX_BYTES) throw new ExportTooLarge();
        progress();
      };
      try {
        if (method === "share") {
          const files = await fetchAll(libraryId, plan, format, signal, onBytes, () => {
            finished += 1;
            progress();
          });
          if (signal.aborted) return;
          if (!navigator.canShare({ files })) {
            dispatch({ type: "error", message: "This browser cannot share these files. Use another method." });
            return;
          }
          dispatch({ type: "ready", files });
        } else if (method === "folder" && folder) {
          const names = new Set<string>();
          for (const planned of plan) {
            const opened = await openPlanned(libraryId, planned, format, signal);
            const name = await freeName(folder, opened.name, names);
            const handle = await folder.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();
            try {
              await pump(opened.response, signal, (chunk) => {
                received += chunk.length;
                progress();
                return writable.write(chunk as BufferSource);
              });
              await writable.close();
            } catch (error) {
              await writable.abort?.().catch(() => {});
              throw error;
            }
            finished += 1;
            progress();
          }
          dispatch({ type: "done", method, saved: plan.length, folder: folder.name });
        } else {
          const names = new Set<string>();
          for (const planned of plan) {
            const opened = await openPlanned(libraryId, planned, format, signal);
            const file = await readToFile(opened, uniqueName(opened.name, names), signal, onBytes);
            saveFile(file, urls.current);
            finished += 1;
            progress();
            await wait(DOWNLOAD_GAP_MS);
          }
          dispatch({ type: "done", method, saved: plan.length });
        }
      } catch (error) {
        if (error instanceof ExportAbort || signal.aborted) return;
        controller.abort(); // stop sibling fetches of a failed batch
        if (error instanceof ExportTooLarge) {
          dispatch({
            type: "blocked",
            message: "These files are too large for one share sheet. Use another method.",
          });
          return;
        }
        dispatch({ type: "error", message: describeExportError(error) });
      }
    },
    [state, libraryId],
  );

  // The user's tap on "Share N items". Nothing awaited before `share()`.
  const confirmShare = useCallback(() => {
    if (state.phase !== "ready" || sharing.current) return;
    sharing.current = true;
    let pending: Promise<void>;
    try {
      pending = navigator.share({ files: state.files });
    } catch (error) {
      sharing.current = false;
      dispatch({ type: "error", message: describeExportError(error) });
      return;
    }
    pending.then(
      () => {
        sharing.current = false;
        release();
        dispatch({ type: "close" });
      },
      (error: unknown) => {
        sharing.current = false;
        // Dismissing the sheet is silent: stay on the confirm screen.
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          dispatch({ type: "hint", hint: "The browser asked for another tap. Tap Share again." });
          return;
        }
        dispatch({ type: "error", message: describeExportError(error) });
      },
    );
  }, [state, release]);

  return { state, caps, open, close, back, setFormat, start, confirmShare };
}

async function freeName(folder: DirectoryHandle, wanted: string, taken: Set<string>): Promise<string> {
  for (;;) {
    const name = uniqueName(wanted, taken);
    try {
      await folder.getFileHandle(name);
      // Exists already in the folder: `taken` now holds it, try the next number.
    } catch {
      return name;
    }
  }
}

// Plain download of one file through a short-lived object URL. The page is
// never navigated: the link carries `download`, and the URL is revoked.
function saveFile(file: File, urls: Set<string>): void {
  const url = URL.createObjectURL(file);
  urls.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    urls.delete(url);
  }, URL_LIFETIME_MS);
}

async function fetchAll(
  libraryId: number,
  plan: PlannedFile[],
  format: ExportFormat,
  signal: AbortSignal,
  onBytes: (n: number) => void,
  onFile: () => void,
): Promise<File[]> {
  const files: File[] = new Array(plan.length);
  const names = new Set<string>();
  let next = 0;
  async function worker() {
    while (next < plan.length) {
      const index = next++;
      const opened: OpenedFile = await openPlanned(libraryId, plan[index], format, signal);
      // Names are settled as files open, in whatever order they open; a
      // duplicate gets " (1)" so the share sheet does not overwrite one file.
      const name = uniqueName(opened.name, names);
      files[index] = await readToFile(opened, name, signal, onBytes);
      onFile();
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, plan.length) }, worker));
  return files;
}
