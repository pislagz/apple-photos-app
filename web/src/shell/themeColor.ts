// #432: the Safari toolbar / status-bar tint (theme-color) must equal the page
// background of the effective appearance. The static metas in index.html cover
// first paint; this keeps them in step with the real `--color-bg` token and
// re-reads it whenever the system appearance flips, so the two cannot drift.
const DARK_QUERY = "(prefers-color-scheme: dark)";

function toHex(rgb: string): string | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(rgb);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

export function syncThemeColor(): void {
  const bg = toHex(getComputedStyle(document.documentElement).backgroundColor);
  if (bg === null) return;
  const dark = window.matchMedia(DARK_QUERY).matches;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Only the meta for the active scheme is read by the browser.
    const media = meta.getAttribute("media");
    if (!media || media.includes("dark") === dark) meta.content = bg;
  }
}

export function installThemeColor(): void {
  syncThemeColor();
  window.matchMedia(DARK_QUERY).addEventListener("change", syncThemeColor);
}
