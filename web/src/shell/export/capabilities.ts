// Capability detection for the export flow. Everything here asks the browser
// whether a feature exists; none of it reads the user agent.

// Minimal shape of the File System Access API (lib.dom has no typing for it).
export interface DirectoryHandle {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
}
export interface FileHandle {
  createWritable(): Promise<{ write(data: BufferSource | Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}
type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle> };

export interface ExportCapabilities {
  // `navigator.share` takes files here (Safari on iOS and Mac, Chromium on Windows/Android...).
  share: boolean;
  // `showDirectoryPicker` (Chrome/Edge desktop). Needs a secure context.
  folder: boolean;
  standalone: boolean;
}

function secure(): boolean {
  return typeof window !== "undefined" && window.isSecureContext !== false;
}

export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !secure()) return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    // Some browsers have `canShare` but refuse files; ask with a real File.
    return navigator.canShare({ files: [new File(["x"], "probe.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

export function canPickDirectory(): boolean {
  return secure() && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

export function detectExportCapabilities(): ExportCapabilities {
  const share = canShareFiles();
  const standalone = isStandaloneApp();
  return { share, folder: canPickDirectory(), standalone };
}

export function pickDirectory(): Promise<DirectoryHandle> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return Promise.reject(new Error("Folder saving is not supported here."));
  return picker.call(window, { mode: "readwrite" });
}
