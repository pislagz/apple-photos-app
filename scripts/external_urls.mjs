// CLAUDE.md "Offline at runtime" / docs/TASKS.md P1.21: the production web
// bundle may contain the OSM tile template, the OSM copyright link, localhost
// URLs, and nothing else external.
//
// Two groups of strings are not network requests and are listed exactly (not
// as prefixes or a w3.org wildcard):
//  - XML namespace URIs that React/the DOM embed in every bundle (SVG, MathML,
//    xlink, xml:, xmlns:). They are identifiers, never fetched.
//  - React's production build embeds "https://react.dev/errors/" as the prefix
//    of the decoder link it prints with a minified error code (".../418").
//    It is only text in a console message; the app never fetches it.
// TASKS.md says "only" the two OSM URLs; these are unavoidable library
// strings and are flagged in the PR for a decision.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

const EXACT_ALLOWED = new Set([
  TILE_TEMPLATE,
  COPYRIGHT_URL,
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/xmlns/",
]);

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;
const REACT_DECODER = /^https:\/\/react\.dev\/errors\/\d*$/;

// A URL embedded in a JS template literal is followed by a backtick; without
// excluding it the match swallows the rest of the template.
const URL_PATTERN = /https?:\/\/[^\s"'()<>`]+/g;

export function isAllowed(url) {
  return EXACT_ALLOWED.has(url) || LOCALHOST.test(url) || REACT_DECODER.test(url);
}

export function findDisallowedUrls(text) {
  return (text.match(URL_PATTERN) ?? []).filter((url) => !isAllowed(url));
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    files.push(...(statSync(path).isDirectory() ? walk(path) : [path]));
  }
  return files;
}

const SCANNED = /\.(js|mjs|css|html)$/;

export function checkDir(dir) {
  const offenders = [];
  for (const file of walk(dir).filter((f) => SCANNED.test(f))) {
    for (const url of findDisallowedUrls(readFileSync(file, "utf-8"))) {
      offenders.push(`${file}: ${url}`);
    }
  }
  return offenders;
}
