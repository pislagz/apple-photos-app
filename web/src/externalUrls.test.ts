import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { findDisallowedUrls } from "../../scripts/external_urls.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/check_external_urls.mjs");
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fakeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const run = (dir: string) => spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" });

describe("check_external_urls", () => {
  it("passes the two OSM URLs, localhost, and library namespace strings", () => {
    const dir = fakeDist({
      "assets/app.js":
        'const t="https://tile.openstreetmap.org/{z}/{x}/{y}.png";' +
        'const ns="http://www.w3.org/2000/svg";fetch("http://127.0.0.1:8000/api");' +
        'const r="https://react.dev/errors/";',
      "index.html": '<a href="https://www.openstreetmap.org/copyright">x</a>',
    });
    expect(run(dir).status).toBe(0);
  });

  it.each([
    ["js", "assets/app.js", 'fetch("https://evil.example/collect")'],
    ["css", "assets/app.css", "a{background:url(https://cdn.example/x.png)}"],
    ["html", "index.html", '<script src="https://cdn.example/x.js"></script>'],
  ])("fails on a disallowed host in %s", (_n, file, body) => {
    const result = run(fakeDist({ [file]: body }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("example");
  });

  it("allows the exact MapLibre/pmtiles library strings and no other path on those hosts", () => {
    expect(findDisallowedUrls('a="https://maplibre.org/";b="http://www.w3.org/1999/xhtml"')).toEqual([]);
    expect(findDisallowedUrls('a="https://maplibre.org/collect"')).toEqual(["https://maplibre.org/collect"]);
  });

  it("does not allow other paths on the OSM hosts or w3.org", () => {
    for (const url of [
      "https://tile.openstreetmap.org/other.png",
      "https://www.openstreetmap.org/api/0.6/map",
      "http://www.w3.org/TR/anything",
      "https://react.dev/learn",
      "http://localhost.evil.example/",
    ]) {
      expect(findDisallowedUrls(`x="${url}"`)).toEqual([url]);
    }
  });

  it("catches a URL inside a template literal", () => {
    expect(findDisallowedUrls("const u = `https://evil.example/c`;")).toEqual(["https://evil.example/c"]);
  });

  it("passes on the real build when one exists", () => {
    const dist = resolve(__dirname, "../dist");
    const exists = spawnSync("test", ["-d", dist]).status === 0;
    if (!exists) return;
    expect(() => execFileSync("node", [SCRIPT, dist])).not.toThrow();
  });
});
