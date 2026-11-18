import { useSyncExternalStore } from "react";

// "Photo Format" (#507, renamed #512): only the file format of HEIC photos on
// Download and Share. Most Compatible converts them to JPEG; HEIC sends them as
// stored (with the Live Photo video). Videos and JPEGs are never converted and
// edits are always included. Stored values stay "automatic" / "original".
export type TransferFormat = "automatic" | "original";

const KEY = "photos-viewer:transfer-format";
// #487 stored a ZIP switch and a per-export choice; neither means anything now.
const OLD_KEYS = ["photos-viewer:download-as-zip"];
const listeners = new Set<() => void>();

function dropOldKeys(): void {
  try {
    for (const key of OLD_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to clean.
  }
}

export function getTransferFormat(): TransferFormat {
  dropOldKeys();
  try {
    return localStorage.getItem(KEY) === "original" ? "original" : "automatic";
  } catch {
    return "automatic";
  }
}

export function setTransferFormat(value: TransferFormat): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked: the setting simply does not stick.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useTransferFormat(): [TransferFormat, (value: TransferFormat) => void] {
  const value = useSyncExternalStore(subscribe, getTransferFormat, () => "automatic" as const);
  return [value, setTransferFormat];
}

export const TRANSFER_FORMAT_OPTIONS: { value: TransferFormat; label: string; detail: string }[] = [
  { value: "automatic", label: "Most Compatible (JPEG)", detail: "HEIC photos are sent as JPEG." },
  { value: "original", label: "HEIC (Original Format)", detail: "HEIC photos are sent as stored, with the video of Live Photos." },
];

export const PHOTO_FORMAT_LABEL = "Photo Format";
// Mac has Download ▾ > Download Unmodified Original; the iPhone has no Download.
export const PHOTO_FORMAT_FOOTER_MAC =
  "For downloads and shares. Edits are always included — for the unedited photo use Download Unmodified Original.";
export const PHOTO_FORMAT_FOOTER_IPHONE = "For sharing. Edits are always included.";
