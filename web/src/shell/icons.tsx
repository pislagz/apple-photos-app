// Small outline icon set in the app's own style (SF Symbols-weight
// strokes), not Apple assets -- stands in for the tab bar / sidebar glyphs
// shown in the design refs. One shared stroke style keeps every icon
// visually consistent at the row heights used on both layouts.
const PATHS: Record<string, string> = {
  library:
    "M4 5.5h9.5a1.5 1.5 0 0 1 1.5 1.5v8.5H5.5A1.5 1.5 0 0 1 4 14V5.5Z M8.5 9h3 M8.5 11.5h5",
  albums:
    "M4.5 5.5h11v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9Z M6.5 5.5V4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1.5",
  people: "M10 10.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z M4.5 16c.6-3 2.6-4.5 5.5-4.5s4.9 1.5 5.5 4.5",
  map: "M10 17s5.5-5.1 5.5-9A5.5 5.5 0 1 0 4.5 8c0 3.9 5.5 9 5.5 9Z M10 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  favorite:
    "M10 17.2s-6.4-3.9-6.4-8.6A3.6 3.6 0 0 1 10 6.4a3.6 3.6 0 0 1 6.4 2.2c0 4.7-6.4 8.6-6.4 8.6Z",
  added: "M10 5v5l3.2 2 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z",
  folder: "M3.5 6.5a1 1 0 0 1 1-1H8l1.5 2h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8.5Z",
  hidden: "M6 9V7a4 4 0 1 1 8 0v2 M5 9h10v6.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9Z",
  tray: "M4.5 5.5h11v5l-2 4h-7l-2-4v-5Z M4.5 10.5h3.2l1 2h2.6l1-2h3.2",
  grid: "M4.5 4.5h4.5v4.5H4.5zM11 4.5h4.5v4.5H11zM4.5 11h4.5v4.5H4.5zM11 11h4.5v4.5H11z",
  search: "M13.5 13.5 16.5 16.5 M9.3 14.6a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6Z",
  download: "M10 4.5v8 M6.8 9.5 10 12.8l3.2-3.3 M4.5 14.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1",
  chevron: "M8 5.5 13.5 10 8 14.5",
  trash: "M5 6.5h10 M8.5 6.5V5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5 M6.5 6.5V15a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6.5",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M10 9.3v4.2 M10 6.8v.1",
  share: "M10 3.5v9 M6.8 6.7 10 3.5l3.2 3.2 M5 11v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-4",
  rotate: "M4.5 4.5h7v7h-7z M11.5 8a4.5 4.5 0 1 0 1.2-3.1 M12.7 3.1v2.4h-2.4",
  more: "M4.5 10a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z M9 10a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z M13.5 10a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z",
  play: "M6.5 5v10l8-5-8-5Z",
  close: "M5.5 5.5 14.5 14.5 M14.5 5.5 5.5 14.5",
  livephoto: "M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M10 12.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",
  video: "M3.5 6.5h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z M12.5 9l4-2.2v6.4l-4-2.2Z",
  camera:
    "M4 7.5a1 1 0 0 1 1-1h1.3l.8-1.2h5.8l.8 1.2H15a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5Z M10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z",
  portrait: "M7.2 14a4.2 4.2 0 1 0 0-8 4.2 4.2 0 0 0 0 8Z M12.8 14a4.2 4.2 0 1 0 0-8 4.2 4.2 0 0 0 0 8Z",
  panorama: "M3 7.5c1.5-1.5 12.5-1.5 14 0v5c-1.5 1.5-12.5 1.5-14 0v-5Z M6 9.5c1.3-.8 6.7-.8 8 0",
  screenshot:
    "M4.5 7V5a1 1 0 0 1 1-1h2 M15.5 7V5a1 1 0 0 1-1-1h-2 M4.5 13v2a1 1 0 0 0 1 1h2 M15.5 13v2a1 1 0 0 1-1 1h-2",
  document:
    "M6 3.5h6l2.5 2.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M12 3.5V6h2.5 M7.5 10h5 M7.5 12.5h5",
  link: "M8.5 11.5a3 3 0 0 0 .6.9l.7.7a3.2 3.2 0 0 0 4.5 0l1.6-1.6a3.2 3.2 0 0 0 0-4.5l-.7-.7a3 3 0 0 0-.9-.6 M11.5 8.5a3 3 0 0 0-.6-.9l-.7-.7a3.2 3.2 0 0 0-4.5 0L4.1 8.5a3.2 3.2 0 0 0 0 4.5l.7.7a3 3 0 0 0 .9.6",
  original: "M3 10s2.8-5 7-5 7 5 7 5-2.8 5-7 5-7-5-7-5Z M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  slomo:
    "M3.5 6.5h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z M12.5 9l4-2.2v6.4l-4-2.2Z M3.5 16.5h9",
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
