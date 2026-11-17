import { useSyncExternalStore } from "react";

// "Download as ZIP" (#487): off by default. Per browser, like the sidebar width.
const KEY = "photos-viewer:download-as-zip";
const listeners = new Set<() => void>();

export function getDownloadAsZip(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDownloadAsZip(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
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

export function useDownloadAsZip(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getDownloadAsZip, () => false);
  return [value, setDownloadAsZip];
}
