import { useCallback, useMemo } from "react";
import { useZipDownload } from "../library/zipDownload";
import { canPickDirectory, canShareFiles } from "./capabilities";
import { downloadItem } from "./downloadItem";
import type { ExportItem } from "./exportModel";
import { useExport } from "./useExport";

// Everything the Mac layout's Share / Download / ▾ menu / context menu do,
// in one place so the toolbar, the viewer and the context menu cannot drift.
// Download is one click for any count: one item is the plain file, 2+ are one
// ZIP (the streamed zip, P3.2). Share and Export to Folder go through the
// export flow.
export function useDesktopTransfer(libraryId: number) {
  const flow = useExport(libraryId);
  const zip = useZipDownload(libraryId);
  const caps = useMemo(() => ({ share: canShareFiles(), folder: canPickDirectory() }), []);

  const download = useCallback(
    (items: ExportItem[], options: { unmodified?: boolean; version?: "original" | "edited" } = {}) => {
      if (items.length === 0) return;
      if (items.length === 1) void downloadItem(libraryId, items[0], options);
      else void zip.start(items.map((item) => item.id), { forceNative: options.unmodified });
    },
    [libraryId, zip.start],
  );

  const { share, exportToFolder } = flow;
  const working = flow.state.phase === "working" ? flow.state.method : null;
  const flowFraction = flow.state.phase === "working" && flow.state.fileCount > 1 && flow.state.method !== "zip" ? flow.state.fileIndex / flow.state.fileCount : null;
  return {
    flow,
    flowFraction,
    zip,
    caps,
    download,
    share,
    exportToFolder,
    // What the toolbar rings show: a ZIP, a folder export or a share fetch.
    downloadBusy: zip.busy || working === "folder" || working === "zip",
    shareBusy: working === "share",
  };
}
