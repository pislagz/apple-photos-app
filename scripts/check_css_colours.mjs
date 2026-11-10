// #218: colours live in web/src/shell/tokens.css and nowhere else. Fails when
// another stylesheet under web/src has a hex or rgb()/rgba()/hsl() literal, or
// its own prefers-color-scheme block (dark values are token overrides).
//
// A literal that must stay (say, inside a data URI) is allowed by putting
// `/* colour-allow: <why> */` on the same line or the line above it.
//
// Usage: node scripts/check_css_colours.mjs [dir]   (default: web/src)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(?:rgba?|hsla?)\(/g;
const SCHEME = /prefers-color-scheme/g;

// Blank out comments (keeping newlines so line numbers survive) but remember
// which lines carry an allow marker.
export function scan(source) {
  const allowed = new Set();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (comment, offset) => {
    const startLine = source.slice(0, offset).split("\n").length;
    if (/colour-allow:/.test(comment)) {
      const lines = comment.split("\n").length;
      allowed.add(startLine + lines); // the line after the comment
      allowed.add(startLine + lines - 1); // or the comment's own last line
    }
    return comment.replace(/[^\n]/g, " ");
  });
  const problems = [];
  stripped.split("\n").forEach((text, index) => {
    const line = index + 1;
    if (allowed.has(line)) return;
    for (const [pattern, what] of [
      [HEX, "hex colour"],
      [FUNC, "rgb/hsl colour"],
      [SCHEME, "prefers-color-scheme block"],
    ]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) problems.push({ line, what, text: match[0] });
    }
  });
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
      console.error(`${file}:${p.line}: ${p.what} \`${p.text}\` outside tokens.css (use a var(--...) token)`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} colour literal(s) outside web/src/shell/tokens.css.`);
    process.exit(1);
  }
  console.log(`check_css_colours: ok (${basename(root)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
