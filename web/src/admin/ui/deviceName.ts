// Turns the stored device text (normally a browser user-agent) into "Safari on iPhone".
// The server keeps the raw text; it only ever appears in a tooltip.

export function deviceName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (text === "") return "Unknown device";
  const os = /iPhone/i.test(text)
    ? "iPhone"
    : /iPad/i.test(text)
      ? "iPad"
      : /Android/i.test(text)
        ? "Android"
        : /Macintosh|Mac OS X/i.test(text)
          ? "Mac"
          : /Windows/i.test(text)
            ? "Windows PC"
            : /CrOS/i.test(text)
              ? "Chromebook"
              : /Linux|X11/i.test(text)
                ? "Linux"
                : null;
  const browser = /Edg(e|A|iOS)?\//.test(text)
    ? "Edge"
    : /OPR\/|Opera/.test(text)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(text)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(text)
          ? "Chrome"
          : /Safari\//.test(text)
            ? "Safari"
            : null;
  if (browser !== null && os !== null) return `${browser} on ${os}`;
  if (browser !== null) return browser;
  if (os !== null) return os;
  // A short plain name someone typed (for example "iPhone") reads fine as it is.
  return text.length <= 40 && !/[/;()]/.test(text) ? text : "Unknown device";
}
