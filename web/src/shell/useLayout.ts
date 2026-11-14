import { useEffect, useState } from "react";

// Layout follows the window alone (#386): below the breakpoint, or on a device
// whose primary pointer isn't fine (touch), gets the mobile (iOS 17) chrome;
// everything else gets the desktop (Sequoia) chrome. There is no manual choice.
export const MOBILE_BREAKPOINT_PX = 768;

export type Layout = "mobile" | "desktop";

// The retired manual choice. A phone that saved "desktop" here must get the
// automatic layout back, so the stale value is deleted on every start.
const LEGACY_OVERRIDE_STORAGE_KEY = "photos-viewer:layout-override";

function safeMatchMedia(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

// Only picks the longer-lived session client type (`session_auth.py`'s
// `client` field); `AppShell` reuses this export. It does not affect the
// layout: an installed Mac PWA is a wide fine-pointer window and gets desktop,
// while the installed iPhone app is narrow/touch and gets mobile anyway.
export function isStandalone(): boolean {
  return safeMatchMedia("(display-mode: standalone)");
}

function detectLayout(): Layout {
  const narrow = window.innerWidth < MOBILE_BREAKPOINT_PX;
  const finePointer = safeMatchMedia("(pointer: fine)");
  return narrow || !finePointer ? "mobile" : "desktop";
}

function clearLegacyOverride() {
  try {
    window.localStorage.removeItem(LEGACY_OVERRIDE_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was saved there that could be read either.
  }
}

export function useLayout(): { layout: Layout } {
  const [layout, setLayout] = useState<Layout>(() => {
    clearLegacyOverride();
    return detectLayout();
  });

  useEffect(() => {
    const onResize = () => setLayout(detectLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { layout };
}
