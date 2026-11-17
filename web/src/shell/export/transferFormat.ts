import { useSyncExternalStore } from "react";

// "Transfer Format" (#507), Apple's wording: Automatic sends photos as JPEG
// (most compatible); Keep Originals sends them as stored (HEIC, with the Live
// Photo video). One setting for Share and Download, per browser.
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
  { value: "automatic", label: "Automatic", detail: "Photos are sent as JPEG, the most compatible format." },
  { value: "original", label: "Keep Originals", detail: "Photos are sent as HEIC, with the video of Live Photos." },
];
