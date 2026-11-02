import { useCallback, useEffect, useState } from "react";

// SPEC.md "Front end": "Detect by viewport width and pointer type, and let
// users override in settings." Below the breakpoint, or on a device whose
// primary pointer isn't fine (mouse/trackpad), gets the mobile (iOS 17)
// chrome; everything else gets the desktop (Sequoia) chrome.
export const MOBILE_BREAKPOINT_PX = 768;

export type Layout = "mobile" | "desktop";
export type LayoutOverride = Layout | "auto";

const OVERRIDE_STORAGE_KEY = "photos-viewer:layout-override";

function safeMatchMedia(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

// The installed PWA gets the mobile chrome regardless of width or pointer
// (SPEC.md "Mobile layout": "used on narrow touch screens and when
// installed as a PWA"); it also picks the longer-lived session client type
// (`session_auth.py`'s `client` field), so `AppShell` reuses this export.
export function isStandalone(): boolean {
  return safeMatchMedia("(display-mode: standalone)");
}

function detectLayout(): Layout {
  const narrow = window.innerWidth < MOBILE_BREAKPOINT_PX;
  const finePointer = safeMatchMedia("(pointer: fine)");
  return narrow || !finePointer || isStandalone() ? "mobile" : "desktop";
}

function readOverride(): LayoutOverride {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(OVERRIDE_STORAGE_KEY);
  return stored === "mobile" || stored === "desktop" ? stored : "auto";
}

export interface UseLayoutResult {
  layout: Layout;
  override: LayoutOverride;
  setOverride: (value: LayoutOverride) => void;
  applyRemoteOverride: (value: LayoutOverride) => void;
}

export function useLayout(): UseLayoutResult {
  const [override, setOverrideState] = useState<LayoutOverride>(readOverride);
  const [detected, setDetected] = useState<Layout>(detectLayout);

  useEffect(() => {
    const onResize = () => setDetected(detectLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setOverride = useCallback((value: LayoutOverride) => {
    setOverrideState(value);
    if (value === "auto") {
      window.localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(OVERRIDE_STORAGE_KEY, value);
    }
  }, []);

  // The server's value (from `/api/me`) is authoritative once it's back --
  // this reconciles the fast localStorage default with it. Same
  // implementation as `setOverride`; kept as a separate name so call sites
  // read as "the server told us" vs. "the user picked this".
  const applyRemoteOverride = setOverride;

  return { layout: override === "auto" ? detected : override, override, setOverride, applyRemoteOverride };
}
