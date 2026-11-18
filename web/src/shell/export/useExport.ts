import { useCallback, useEffect, useReducer, useRef } from "react";
import { getSelectionSummary } from "../../api";
import { canPickDirectory, canShareFiles, pickDirectory, type DirectoryHandle } from "./capabilities";
import { navigateToZip, requestZipTicket } from "../library/zipDownload";
import {
  describeExportError,
  ExportAbort,
  ExportShareError,
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
  formatFor,
  IDLE,
  SHARE_MAX_BYTES,
  shareBlockReason,
  uniqueName,
  type ExportFormat,
  type ExportItem,
  type ExportMethod,
} from "./exportModel";
import { getTransferFormat } from "./transferFormat";

// Only one export runs at a time, across every screen that can start one: a
// second tap (or the phone layout in a desktop browser, which mounts two
// entry points) must not stack a second sheet.
let activeOwner: symbol | null = null;

const FETCH_CONCURRENCY = 3;

export function useExport(libraryId: number) {
  const [state, dispatch] = useReducer(exportReducer, IDLE);
  const owner = useRef(Symbol("export"));
  const abort = useRef<AbortController | null>(null);
  const sharing = useRef(false);
  const last = useRef<{ method: ExportMethod; items: ExportItem[] } | null>(null);

  const release = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    if (activeOwner === owner.current) activeOwner = null;
  }, []);

  useEffect(() => release, [release]);

  const close = useCallback(() => {
    release();
    dispatch({ type: "close" });
  }, [release]);

  const finish = useCallback(() => {
    if (activeOwner === owner.current) activeOwner = null;
  }, []);

  // Runs one export end to end. `share` hands the files to the system share
  // sheet at the end, with no extra tap while the click's user activation is
  // still valid; otherwise it parks in "ready" and asks for one tap.
  const run = useCallback(
    async (method: ExportMethod, items: ExportItem[]) => {
      if (items.length === 0 || activeOwner) return;
      activeOwner = owner.current;
      sharing.current = false;
      last.current = { method, items };
      const format: ExportFormat = formatFor(getTransferFormat());
      // Folder picker first, with no await before it: it needs the click's user activation.
      let folder: DirectoryHandle | null = null;
      if (method === "folder") {
        try {
          folder = await pickDirectory();
        } catch (error) {
          finish();
          if (error instanceof DOMException && error.name === "AbortError") return;
          dispatch({ type: "error", method, items, message: describeExportError(error) });
          return;
        }
      }
      const controller = new AbortController();
      abort.current = controller;
      const { signal } = controller;
      const plan = planFiles(items, format);
      dispatch({ type: "start", method, items, fileCount: plan.length });
      let received = 0;
      let finished = 0;
      const progress = () => dispatch({ type: "progress", fileIndex: finished, received });
      const onBytes = (n: number) => {
        received += n;
        if (method === "share" && received > SHARE_MAX_BYTES) throw new ExportTooLarge();
        progress();
      };
      try {
        if (method === "zip") {
          const ticket = await requestZipTicket(libraryId, items.map((item) => item.id), format === "jpeg" ? "jpeg" : "native");
          if (signal.aborted) return;
          navigateToZip(libraryId, ticket.ticket);
          close();
        } else if (method === "share") {
          const sizeKnown = format === "original" && items.length > 1;
          const bytes = sizeKnown
            ? await getSelectionSummary(libraryId, items.map((item) => item.id)).then(
                (summary) => summary.total_bytes,
                () => null,
              )
            : null;
          if (signal.aborted) return;
          const reason = shareBlockReason(items.length, bytes, format);
          if (reason) {
            finish();
            dispatch({ type: "blocked", items, message: reason });
            return;
          }
          const files = await fetchAll(libraryId, plan, format, signal, onBytes, () => {
            finished += 1;
            progress();
          });
          if (signal.aborted) return;
          if (!canShareNow(files)) {
            finish();
            dispatch({ type: "error", method, items, message: "This browser cannot share these files." });
            return;
          }
          const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
          if (activation && !activation.isActive) {
            dispatch({ type: "ready", items, files });
            return;
          }
          await openSheet(files, items);
        } else if (folder) {
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
          finish();
          dispatch({ type: "done", method, saved: plan.length, folder: folder.name });
        }
      } catch (error) {
        if (error instanceof ExportAbort || signal.aborted) return;
        controller.abort(); // stop sibling fetches of a failed batch
        finish();
        if (error instanceof ExportTooLarge) {
          dispatch({ type: "blocked", items, message: "These files are too large for one share sheet." });
          return;
        }
        dispatch({ type: "error", method, items, message: describeExportError(error) });
      }
      // The share sheet itself: resolves when the user picks or dismisses.
      async function openSheet(files: File[], shared: ExportItem[]) {
        sharing.current = true;
        try {
          await navigator.share({ files });
          sharing.current = false;
          close();
        } catch (error) {
          sharing.current = false;
          if (error instanceof DOMException && error.name === "AbortError") {
            close();
          } else if (error instanceof DOMException && error.name === "NotAllowedError") {
            dispatch({ type: "ready", items: shared, files });
          } else {
            finish();
            dispatch({ type: "error", method: "share", items: shared, message: describeExportError(new ExportShareError(error)) });
          }
        }
      }
    },
    [libraryId, close, finish],
  );

  // The tap on "Share N Items". Nothing awaited before `share()`.
  const confirmShare = useCallback(() => {
    if (state.phase !== "ready" || sharing.current) return;
    const { files, items } = state;
    sharing.current = true;
    let pending: Promise<void>;
    try {
      pending = navigator.share({ files });
    } catch (error) {
      sharing.current = false;
      dispatch({ type: "error", method: "share", items, message: describeExportError(new ExportShareError(error)) });
      return;
    }
    pending.then(
      () => {
        sharing.current = false;
        close();
      },
      (error: unknown) => {
        sharing.current = false;
        // Dismissing the sheet ends the flow, like on the phone's own share sheet.
        if (error instanceof DOMException && error.name === "AbortError") {
          close();
          return;
        }
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          dispatch({ type: "hint", hint: "The browser asked for another tap. Tap Share again." });
          return;
        }
        dispatch({ type: "error", method: "share", items, message: describeExportError(new ExportShareError(error)) });
      },
    );
  }, [state, close]);

  const retry = useCallback(() => {
    const again = last.current;
    release();
    dispatch({ type: "close" });
    if (again) void run(again.method, again.items);
  }, [release, run]);

  const share = useCallback((items: ExportItem[]) => run("share", items), [run]);
  const exportToFolder = useCallback((items: ExportItem[]) => run("folder", items), [run]);
  const saveZip = useCallback((items: ExportItem[]) => run("zip", items), [run]);

  return { state, share, exportToFolder, saveZip, retry, close, confirmShare, canShare: canShareFiles, canFolder: canPickDirectory };
}

// `canShare` can itself throw (WebIDL conversion of the file list); that is a
// share problem, reported as one, never as a dropped connection.
function canShareNow(files: File[]): boolean {
  try {
    return navigator.canShare({ files });
  } catch (error) {
    throw new ExportShareError(error);
  }
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
