import { useId } from "react";

// The app's own icon set, drawn from scratch on a 20x20 grid. Nothing here is
// copied, traced or derived from Apple's SF Symbols or any third-party set.
//
// Style: 1.5 stroke, round caps and joins, ~2px corner radii, outline by
// default. Selected rows and tabs pass `filled` for a solid variant.
//
// A part is [path, mode]:
//   "s"  stroke only          "f"  fill only          "fs" fill + stroke
//   "k"  knockout stroke      "kf" knockout fill      (cut out of the solid
//        shapes via a mask, so detail stays visible on any background)
type Mode = "s" | "f" | "fs" | "k" | "kf";
type Part = readonly [d: string, mode: Mode];
type IconDef = { parts: readonly Part[]; filled?: readonly Part[] };

const n = (v: number) => String(+v.toFixed(2));

// Rounded-rect path helper, so corner radii stay uniform across the set.
function rr(x: number, y: number, w: number, h: number, r: number): string {
  const iw = w - 2 * r;
  const ih = h - 2 * r;
  const a = `a${n(r)} ${n(r)} 0 0 1`;
  return (
    `M${n(x + r)} ${n(y)}h${n(iw)}${a} ${n(r)} ${n(r)}v${n(ih)}${a} ${n(-r)} ${n(r)}` +
    `h${n(-iw)}${a} ${n(-r)} ${n(-r)}v${n(-ih)}${a} ${n(r)} ${n(-r)}Z`
  );
}

// Circle path helper (two arcs, so it can take a fill or a stroke).
const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx)} ${n(cy + r)}a${n(r)} ${n(r)} 0 1 0 0 ${n(-2 * r)} ${n(r)} ${n(r)} 0 0 0 0 ${n(2 * r)}Z`;

// Short radial dashes (round caps make them read as dots) evenly spaced on a
// ring; the Live Photo icon's outer ring.
function ringDashes(cx: number, cy: number, r: number, count: number, half: number): string {
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    const t = half / r;
    const p = (ang: number) => `${n(cx + r * Math.sin(ang))} ${n(cy - r * Math.cos(ang))}`;
    d += `M${p(a - t)}A${n(r)} ${n(r)} 0 0 1 ${p(a + t)}`;
  }
  return d;
}

// Approved sample shapes (sample sheet v1), used as drawn.
const LIBRARY_BACK = "M6.5 6.3V5.6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-.8";
const LIBRARY_FRONT = "M4.5 6.5h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z";
const LIBRARY_HILLS = "M2.7 14.6l2.9-2.8a1 1 0 0 1 1.4 0l3.6 3.6 M9.6 13.7l1-1a1 1 0 0 1 1.4 0l2.3 2.3";
const LIBRARY_SUN = "M11.2 10.3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";
const ALBUMS_BODY = "M5 7.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z";
const ALBUMS_TOP = "M5 5h10 M7 2.8h6";
const HEART =
  "M10 16.4c-.25 0-.5-.08-.7-.24C6.5 13.9 3 11.1 3 7.8 3 5.7 4.6 4 6.7 4c1.4 0 2.5.7 3.3 1.8C10.8 4.7 11.9 4 13.3 4 15.4 4 17 5.7 17 7.8c0 3.3-3.5 6.1-6.3 8.36-.2.16-.45.24-.7.24Z";
const PEOPLE_HEAD = "M8 10a2.7 2.7 0 1 0 0-5.4A2.7 2.7 0 0 0 8 10Z";
const PEOPLE_BODY = "M3 16.3c.2-2.6 2.3-4.3 5-4.3s4.8 1.7 5 4.3";
const PEOPLE_SECOND = "M12.6 4.9a2.4 2.4 0 1 1 .9 4.6 M14.4 11.6c1.5.4 2.5 1.6 2.6 3.2";
const MAP_SHEET =
  "M2.8 5.6v9.6c0 .5.5.8 1 .6l3.6-1.6 5.2 2 3.6-1.6c.4-.2.6-.5.6-.9V4.1c0-.5-.5-.8-1-.6L12.6 5.1l-5.2-2-3.9 1.7c-.4.2-.7.5-.7.8Z";
const MAP_FOLDS = "M7.4 3.1v11.1 M12.6 5.1v11.1";
const INFO_RING = "M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z";
const INFO_STEM = "M10 9.2v4.6";
const INFO_DOT = "M10 7.4a.95.95 0 1 0 0-1.9.95.95 0 0 0 0 1.9Z";

const LIVE_DASHES = ringDashes(10, 10, 8.5, 8, 1);
// Chain link: two open hooks (r 2.9 caps) on the 45 degree diagonal, tips
// facing each other across a small gap where the links interlock.
const LINK_A = "M11.2 12.9L8.59 15.52A2.9 2.9 0 0 1 4.48 11.41L7.1 8.8";
const LINK_B = "M12.9 11.2L15.52 8.59A2.9 2.9 0 0 0 11.41 4.48L8.8 7.1";
const VIDEO_BODY = rr(2.5, 5.5, 10.5, 9, 2);
const VIDEO_LENS = "M13 8.7l3.3-1.9a.8.8 0 0 1 1.2.7v5a.8.8 0 0 1-1.2.7L13 11.3";
const DOC_BODY =
  "M6.5 2.8h4.7c.4 0 .8.2 1.1.5l2.7 2.7c.3.3.5.7.5 1.1V15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2Z";
const DOC_FOLD = "M11.4 3.2v2.5a1 1 0 0 0 1 1h2.6";
const DOC_LINES = "M7.5 11h5 M7.5 13.8h3.5";
const FOLDER =
  "M3 6.5a2 2 0 0 1 2-2h2.6c.5 0 .9.2 1.2.6l.8 1H15a2 2 0 0 1 2 2v6.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z";
const LOCK_BODY = rr(4, 9, 12, 8, 2);
const LOCK_SHACKLE = "M6.8 9V6.6a3.2 3.2 0 0 1 6.4 0V9";
const TRAY =
  "M3.5 11.5l1.6-5.6a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.6 5.6v3a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-3Z";
const TRAY_SLOT = "M3.5 11.5h3.4l.8 1.6h4.6l.8-1.6h3.4";
const CAMERA_BODY = rr(2.5, 6, 15, 10.5, 2.5);
const CAMERA_BUMP = "M7 6l.9-1.5a1 1 0 0 1 .9-.5h2.4a1 1 0 0 1 .9.5L13 6";
const CALENDAR_BODY = rr(3, 4.5, 14, 12.5, 2);
const CALENDAR_RINGS = "M7 2.8v3 M13 2.8v3";
const CLOCK = circle(10, 10, 7.2);
const CLOCK_HANDS = "M10 6v4.2l2.6 1.6";
const PHOTO_FRAME = rr(3, 3.5, 14, 13, 2.5);
const FILTER_LINES = "M6.4 7.4h7.2 M7.8 10h4.4 M9.1 12.6h1.8";

export const ICONS = {
  // --- Approved sample sheet ---
  library: {
    parts: [
      [LIBRARY_BACK, "s"],
      [LIBRARY_FRONT, "s"],
      [LIBRARY_HILLS, "s"],
      [LIBRARY_SUN, "f"],
    ],
    filled: [
      [LIBRARY_BACK, "s"],
      [LIBRARY_FRONT, "fs"],
      [LIBRARY_HILLS, "k"],
      [LIBRARY_SUN, "kf"],
    ],
  },
  albums: {
    parts: [
      [ALBUMS_BODY, "s"],
      [ALBUMS_TOP, "s"],
    ],
    filled: [
      [ALBUMS_BODY, "f"],
      [ALBUMS_TOP, "s"],
    ],
  },
  favorite: {
    parts: [[HEART, "s"]],
    filled: [[HEART, "fs"]],
  },
  people: {
    parts: [
      [PEOPLE_HEAD, "s"],
      [PEOPLE_BODY, "s"],
      [PEOPLE_SECOND, "s"],
    ],
    filled: [
      [PEOPLE_HEAD, "fs"],
      [`${PEOPLE_BODY}Z`, "fs"],
      [PEOPLE_SECOND, "s"],
    ],
  },
  map: {
    parts: [
      [MAP_SHEET, "s"],
      [MAP_FOLDS, "s"],
    ],
    filled: [
      [MAP_SHEET, "fs"],
      [MAP_FOLDS, "k"],
    ],
  },
  search: { parts: [["M8.7 14a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6Z M12.6 12.6l4.2 4.2", "s"]] },
  share: {
    parts: [
      ["M10 2.9v9.3 M7 5.8 10 2.8l3 3", "s"],
      ["M7.2 8H6.2a2 2 0 0 0-2 2v5.2a2 2 0 0 0 2 2h7.6a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-1", "s"],
    ],
  },
  trash: {
    parts: [
      ["M3.5 5.5h13 M7.6 5.5V4.3c0-.7.5-1.3 1.2-1.3h2.4c.7 0 1.2.6 1.2 1.3v1.2", "s"],
      [
        "M5 5.5l.75 10.2c.08 1 .9 1.8 1.9 1.8h4.7c1 0 1.82-.8 1.9-1.8L15 5.5 M8.3 8.6v5.8 M11.7 8.6v5.8",
        "s",
      ],
    ],
  },
  info: {
    parts: [
      [`${INFO_RING} ${INFO_STEM}`, "s"],
      [INFO_DOT, "f"],
    ],
    filled: [
      [INFO_RING, "f"],
      [INFO_STEM, "k"],
      [INFO_DOT, "kf"],
    ],
  },
  sidebar: {
    parts: [
      [
        "M4.6 4h10.8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M8 4v12 M4.6 7h1.5 M4.6 9.3h1.5",
        "s",
      ],
    ],
  },

  // --- Drawn to match ---
  days: {
    parts: [
      [CALENDAR_BODY, "s"],
      ["M3 8.4h14", "s"],
      [CALENDAR_RINGS, "s"],
    ],
    filled: [
      [CALENDAR_BODY, "f"],
      ["M3 8.4h14", "k"],
      [CALENDAR_RINGS, "s"],
    ],
  },
  added: {
    parts: [
      [CLOCK, "s"],
      [CLOCK_HANDS, "s"],
    ],
    filled: [
      [CLOCK, "f"],
      [CLOCK_HANDS, "k"],
    ],
  },
  folder: {
    parts: [[FOLDER, "s"]],
    filled: [
      [FOLDER, "f"],
      ["M3 8.6h14", "k"],
    ],
  },
  hidden: {
    parts: [
      [LOCK_BODY, "s"],
      [LOCK_SHACKLE, "s"],
    ],
    filled: [
      [LOCK_BODY, "f"],
      [LOCK_SHACKLE, "s"],
    ],
  },
  tray: {
    parts: [[TRAY, "s"], [TRAY_SLOT, "s"]],
    filled: [
      [TRAY, "f"],
      [TRAY_SLOT, "k"],
    ],
  },
  grid: {
    parts: [
      [rr(3.5, 3.5, 5.5, 5.5, 1.6), "s"],
      [rr(11, 3.5, 5.5, 5.5, 1.6), "s"],
      [rr(3.5, 11, 5.5, 5.5, 1.6), "s"],
      [rr(11, 11, 5.5, 5.5, 1.6), "s"],
    ],
    filled: [
      [rr(3.5, 3.5, 5.5, 5.5, 1.6), "fs"],
      [rr(11, 3.5, 5.5, 5.5, 1.6), "fs"],
      [rr(3.5, 11, 5.5, 5.5, 1.6), "fs"],
      [rr(11, 11, 5.5, 5.5, 1.6), "fs"],
    ],
  },
  // Own drawing in the spirit of icloud.and.arrow.down: an outline cloud (small
  // left bump, large middle bump, medium right bump, tangent fillets between
  // them) that is OPEN at the bottom centre. The down arrow starts inside the
  // cloud and passes through that gap, so its chevron sits below the base.
  download: {
    parts: [
      [
        "M7.1 12.7H4.8A3 3 0 0 1 3.53 6.98A.8.8 0 0 0 3.98 6.4A4.9 4.9 0 0 1 13.26 5.27A.8.8 0 0 0 14.1 5.74A3.5 3.5 0 1 1 14.6 12.7H12.9",
        "s",
      ],
      ["M10 7.8V17.3M7.7 15L10 17.3L12.3 15", "s"],
    ],
  },
  // Photos' "Filter By": a circle with three lines of decreasing length.
  filter: {
    parts: [
      [circle(10, 10, 7.2), "s"],
      [FILTER_LINES, "s"],
    ],
    filled: [
      [circle(10, 10, 7.2), "f"],
      [FILTER_LINES, "k"],
    ],
  },
  chevron: { parts: [["M7.5 4.5 13 10l-5.5 5.5", "s"]] },
  // "Show whole photos": a wide photo shown entire inside the corners of a
  // square tile, instead of cropped to fill it.
  aspect: {
    parts: [
      [rr(2.5, 4.5, 15, 11, 2.4), "s"],
      ["M6.4 9.2V7.9a.6.6 0 0 1 .6-.6h1.5 M13.6 10.8v1.3a.6.6 0 0 1-.6.6h-1.5", "s"],
    ],
    filled: [
      [rr(2.5, 4.5, 15, 11, 2.4), "fs"],
      ["M6.4 9.2V7.9a.6.6 0 0 1 .6-.6h1.5 M13.6 10.8v1.3a.6.6 0 0 1-.6.6h-1.5", "k"],
    ],
  },
  // Filter menu rows (iPhone Library menu).
  edited: {
    parts: [
      ["M3.5 5.5h4.4 M11.7 5.5h4.8 M3.5 10h7.3 M14.6 10h1.9 M3.5 14.5h1.6 M8.9 14.5h7.6", "s"],
      [circle(9.8, 5.5, 1.9), "s"],
      [circle(12.7, 10, 1.9), "s"],
      [circle(7, 14.5, 1.9), "s"],
    ],
  },
  zoomIn: {
    parts: [
      [circle(8.7, 8.7, 5.3), "s"],
      ["M12.6 12.6l4.2 4.2 M6.4 8.7h4.6 M8.7 6.4v4.6", "s"],
    ],
  },
  zoomOut: {
    parts: [
      [circle(8.7, 8.7, 5.3), "s"],
      ["M12.6 12.6l4.2 4.2 M6.4 8.7h4.6", "s"],
    ],
  },
  shared: {
    parts: [
      [circle(12.4, 7.2, 2.3), "s"],
      ["M8.3 16a4.1 4.1 0 0 1 8.2 0Z", "s"],
      [circle(5.6, 8.6, 1.6), "s"],
      ["M2.6 14.6a3.1 3.1 0 0 1 3.3-2.9", "s"],
    ],
  },
  notInAlbum: {
    parts: [
      [rr(3.5, 5.5, 13, 10, 2), "s"],
      ["M6 3.5h8 M3 3l14 14", "s"],
    ],
  },
  plus: { parts: [["M10 4.5v11 M4.5 10h11", "s"]] },
  minus: { parts: [["M4.5 10h11", "s"]] },
  more: {
    parts: [
      [circle(4.5, 10, 1.3), "f"],
      [circle(10, 10, 1.3), "f"],
      [circle(15.5, 10, 1.3), "f"],
    ],
  },
  play: {
    parts: [["M7 4.8v10.4a.8.8 0 0 0 1.2.7l8-5.2a.8.8 0 0 0 0-1.4l-8-5.2A.8.8 0 0 0 7 4.8Z", "fs"]],
  },
  close: { parts: [["M5 5l10 10 M15 5 5 15", "s"]] },
  livephoto: {
    parts: [
      [circle(10, 10, 1.9), "f"],
      [circle(10, 10, 5), "s"],
      [LIVE_DASHES, "s"],
    ],
    filled: [
      [circle(10, 10, 5.75), "f"],
      [circle(10, 10, 1.9), "kf"],
      [LIVE_DASHES, "s"],
    ],
  },
  video: {
    parts: [
      [VIDEO_BODY, "s"],
      [VIDEO_LENS, "s"],
    ],
    filled: [
      [VIDEO_BODY, "fs"],
      [VIDEO_LENS, "fs"],
    ],
  },
  slomo: {
    parts: [
      [rr(2.5, 3.8, 10.5, 8.4, 2), "s"],
      ["M13 6.6l3.3-1.9a.8.8 0 0 1 1.2.7v4.4a.8.8 0 0 1-1.2.7L13 9.6", "s"],
      ["M3 16.2h2.4 M7.8 16.2h2.4 M12.6 16.2H15", "s"],
    ],
    filled: [
      [rr(2.5, 3.8, 10.5, 8.4, 2), "fs"],
      ["M13 6.6l3.3-1.9a.8.8 0 0 1 1.2.7v4.4a.8.8 0 0 1-1.2.7L13 9.6", "fs"],
      ["M3 16.2h2.4 M7.8 16.2h2.4 M12.6 16.2H15", "s"],
    ],
  },
  camera: {
    parts: [
      [CAMERA_BODY, "s"],
      [CAMERA_BUMP, "s"],
      [circle(10, 11.2, 2.7), "s"],
    ],
    filled: [
      [CAMERA_BODY, "fs"],
      [CAMERA_BUMP, "s"],
      [circle(10, 11.2, 2.7), "k"],
    ],
  },
  portrait: {
    parts: [
      [rr(3, 3, 14, 14, 3), "s"],
      [circle(10, 8.3, 2.1), "s"],
      ["M6 14.6c.3-1.9 1.8-3.1 4-3.1s3.7 1.2 4 3.1", "s"],
    ],
    filled: [
      [rr(3, 3, 14, 14, 3), "fs"],
      [circle(10, 8.3, 2.1), "kf"],
      ["M6 14.6c.3-1.9 1.8-3.1 4-3.1s3.7 1.2 4 3.1Z", "kf"],
    ],
  },
  panorama: {
    parts: [
      ["M2.5 5.2c4.8 2 10.2 2 15 0v9.6c-4.8-2-10.2-2-15 0V5.2Z", "s"],
      ["M6 11.8l2.6-2.7 2.2 2.2 1.4-1.4 2.2 2.2", "s"],
    ],
    filled: [
      ["M2.5 5.2c4.8 2 10.2 2 15 0v9.6c-4.8-2-10.2-2-15 0V5.2Z", "fs"],
      ["M6 11.8l2.6-2.7 2.2 2.2 1.4-1.4 2.2 2.2", "k"],
    ],
  },
  screenshot: {
    parts: [
      [
        "M3.5 7V5.5a2 2 0 0 1 2-2H7 M13 3.5h1.5a2 2 0 0 1 2 2V7 M16.5 13v1.5a2 2 0 0 1-2 2H13 M7 16.5H5.5a2 2 0 0 1-2-2V13",
        "s",
      ],
      [rr(7.2, 7.5, 5.6, 5, 1), "s"],
    ],
    filled: [
      [
        "M3.5 7V5.5a2 2 0 0 1 2-2H7 M13 3.5h1.5a2 2 0 0 1 2 2V7 M16.5 13v1.5a2 2 0 0 1-2 2H13 M7 16.5H5.5a2 2 0 0 1-2-2V13",
        "s",
      ],
      [rr(7.2, 7.5, 5.6, 5, 1), "fs"],
    ],
  },
  document: {
    parts: [
      [DOC_BODY, "s"],
      [DOC_FOLD, "s"],
      [DOC_LINES, "s"],
    ],
    filled: [
      [DOC_BODY, "f"],
      [DOC_FOLD, "k"],
      [DOC_LINES, "k"],
    ],
  },
  link: {
    parts: [
      [LINK_A, "s"],
      [LINK_B, "s"],
    ],
  },
  original: {
    parts: [
      [PHOTO_FRAME, "s"],
      ["M3.5 13.8l3.7-3.4a1 1 0 0 1 1.4 0l4.8 4.4 M12 12.9l.8-.8a1 1 0 0 1 1.4 0l2.3 2.2", "s"],
      [circle(13.2, 7.6, 1.1), "f"],
    ],
    filled: [
      [PHOTO_FRAME, "fs"],
      ["M3.5 13.8l3.7-3.4a1 1 0 0 1 1.4 0l4.8 4.4 M12 12.9l.8-.8a1 1 0 0 1 1.4 0l2.3 2.2", "k"],
      [circle(13.2, 7.6, 1.1), "kf"],
    ],
  },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

// Icons with an explicit solid variant for selected rows and tabs. The rest
// fall back to a heavier stroke when `filled` is requested.
export function hasFilledVariant(name: IconName): boolean {
  return "filled" in ICONS[name];
}

function paint(mode: Mode, weight: number) {
  const fill = mode === "f" || mode === "fs" ? "currentColor" : "none";
  const stroked = mode === "s" || mode === "fs";
  return {
    fill,
    stroke: stroked ? "currentColor" : "none",
    strokeWidth: weight,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function Icon({
  name,
  size = 18,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  const maskId = `icon-cut-${useId().replace(/:/g, "")}`;
  const def: IconDef = ICONS[name];
  const variant = filled ? def.filled : undefined;
  const parts = variant ?? def.parts;
  // No solid variant: show the selected state with a heavier line instead.
  const weight = filled && !variant ? 2 : 1.5;
  const solid = parts.filter(([, mode]) => mode !== "k" && mode !== "kf");
  const cuts = parts.filter(([, mode]) => mode === "k" || mode === "kf");
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {cuts.length > 0 && (
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="#fff" />
          {cuts.map(([d, mode]) => (
            <path
              key={d}
              d={d}
              fill={mode === "kf" ? "#000" : "none"}
              stroke={mode === "k" ? "#000" : "none"}
              strokeWidth={weight}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </mask>
      )}
      <g mask={cuts.length > 0 ? `url(#${maskId})` : undefined}>
        {solid.map(([d, mode]) => (
          <path key={d} d={d} {...paint(mode, weight)} />
        ))}
      </g>
    </svg>
  );
}
