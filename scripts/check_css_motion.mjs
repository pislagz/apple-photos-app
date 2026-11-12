// #206: durations live in web/src/shell/tokens.css and nowhere else. Fails when
// another stylesheet under web/src gives a transition or animation a literal
// time (200ms, 0.2s) instead of a var(--dur-...) token.
//
// A literal that must stay is allowed by putting `/* motion-allow: <why> */`
// on the same line or the line above it.
//
// Usage: node scripts/check_css_motion.mjs [dir]   (default: web/src)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DECLARATION = /(?<![\w-])(?:transition|animation)(?:-duration|-delay)?\s*:([^;}]*)/g;
const TIME = /(?<![\w.-])(?:\d*\.)?\d+(?:ms|s)(?![\w-])/g;

export function scan(source) {
  const allowed = new Set();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (comment, offset) => {
    const startLine = source.slice(0, offset).split("\n").length;
    if (/motion-allow:/.test(comment)) {
      const lines = comment.split("\n").length;
      allowed.add(startLine + lines);
      allowed.add(startLine + lines - 1);
    }
    return comment.replace(/[^\n]/g, " ");
  });
  const problems = [];
  for (const decl of stripped.matchAll(DECLARATION)) {
    const valueStart = decl.index + decl[0].length - decl[1].length;
    for (const time of decl[1].matchAll(TIME)) {
      const line = stripped.slice(0, valueStart + time.index).split("\n").length;
      const declLine = stripped.slice(0, decl.index).split("\n").length;
      if (allowed.has(line) || allowed.has(declLine)) continue;
      problems.push({ line, text: time[0] });
    }
  }
  return problems;
}

function* cssFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules") yield* cssFiles(path);
    } else if (name.endsWith(".css") && name !== "tokens.css") {
      yield path;
    }
  }
}

function main() {
  const root = resolve(process.argv[2] ?? "web/src");
  let failures = 0;
  for (const file of cssFiles(root)) {
    for (const p of scan(readFileSync(file, "utf8"))) {
      failures += 1;
      console.error(`${file}:${p.line}: duration \`${p.text}\` outside tokens.css (use a var(--dur-...) token)`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} hard-coded duration(s) outside web/src/shell/tokens.css.`);
    process.exit(1);
  }
  console.log(`check_css_motion: ok (${basename(root)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
