#!/usr/bin/env node
// CLAUDE.md "Offline at runtime": the production web bundle may contain the
// OSM tile template, the OSM copyright link, and nothing else external.
// React/the DOM also embed a handful of XML namespace URIs in every bundle
// (SVG, MathML, xlink, xml:, xmlns:) -- those are not network requests, so
// they are allow-listed exactly, not wildcarded under w3.org. React's
// production build also embeds the literal prefix "https://react.dev/errors/"
// used only to build the human-readable decoder link printed alongside a
// minified error code (e.g. "...errors/418"); the app never fetches it.
//
// Usage:
//   node check_external_urls.mjs <dir>   exit 1 and print offenders if any
//   node check_external_urls.mjs --self-test   verify the allow-list itself

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_PREFIXES = [
  "https://tile.openstreetmap.org/",
  "https://www.openstreetmap.org/copyright",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/xmlns/",
  "https://react.dev/errors/",
];

// Mirrors the character class the old grep-based check used, plus a
// backtick: a URL embedded in a JS template literal is followed by one,
// and without excluding it the match swallows the rest of the template.
const URL_PATTERN = /https?:\/\/[^\s"'()<>`]+/g;

export function findDisallowedUrls(text) {
  const matches = text.match(URL_PATTERN) ?? [];
  return matches.filter((url) => !ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix)));
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    files.push(...(statSync(path).isDirectory() ? walk(path) : [path]));
  }
  return files;
}

function checkDir(dir) {
  const offenders = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf-8");
    for (const url of findDisallowedUrls(text)) offenders.push(`${file}: ${url}`);
  }
  return offenders;
}

function selfTest() {
  const allowedSamples = [
    "https://tile.openstreetmap.org/14/8192/5461.png",
    "https://www.openstreetmap.org/copyright",
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink">',
    '<annotation encoding="http://www.w3.org/1998/Math/MathML">',
    "// http://www.w3.org/XML/1998/namespace",
    "// http://www.w3.org/2000/xmlns/",
    "Minified React error #418; visit https://react.dev/errors/418 for the full message.",
  ];
  for (const sample of allowedSamples) {
    const disallowed = findDisallowedUrls(sample);
    if (disallowed.length > 0) {
      throw new Error(`self-test failed: allow-listed sample was rejected: ${sample} -> ${disallowed}`);
    }
  }

  const evil = findDisallowedUrls('fetch("https://evil.example/collect")');
  if (evil.length !== 1 || evil[0] !== "https://evil.example/collect") {
    throw new Error(`self-test failed: fixture URL was not caught, got ${JSON.stringify(evil)}`);
  }

  const backtick = findDisallowedUrls("const u = `https://evil.example/collect`;");
  if (backtick.length !== 1 || backtick[0] !== "https://evil.example/collect") {
    throw new Error(`self-test failed: backtick-delimited URL was not caught, got ${JSON.stringify(backtick)}`);
  }

  console.log("self-test passed");
}

const [arg] = process.argv.slice(2);
if (!arg) {
  console.error("usage: check_external_urls.mjs <dist-dir> | --self-test");
  process.exit(2);
}

// Every real run self-tests first: a loosened allow-list regex should fail
// loudly here, not quietly pass a weakened check on the real build.
try {
  selfTest();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (arg !== "--self-test") {
  const offenders = checkDir(arg);
  if (offenders.length > 0) {
    console.error("Unexpected external URL(s) in the production build:");
    for (const line of offenders) console.error(line);
    process.exit(1);
  }
  console.log(`ok: no unexpected external URLs under ${arg}`);
}
