import { type Page, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// P2.3 acceptance. Needs the demo server (scripts/dev_demo.py), whose
// library has photos with locations. No real network: tile.openstreetmap.org
// is answered by page.route, and every other external request fails the test.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const TILE_HOST = "tile.openstreetmap.org";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Mode = "online" | "local_file" | "off";

async function setMode(page: Page, mode: Mode, path: string | null) {
  const current = await (await page.request.get("/api/admin/settings")).json();
  const response = await page.request.put("/api/admin/settings", {
    // The mode follows the consent; a file with consent is only the fallback.
    data: { ...current, osm_consent: mode === "online", map_tiles_pmtiles_path: path },
  });
  expect(response.ok()).toBe(true);
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

function watch(page: Page) {
  const external: string[] = [];
  const tiles: string[] = [];
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.host === TILE_HOST) tiles.push(request.url());
    else if (url.host !== new URL(page.url() === "about:blank" ? "http://x" : page.url()).host && !/^(127\.0\.0\.1|localhost)/.test(url.host)) {
      external.push(request.url());
    }
  });
  return { external, tiles, problems };
}

async function openMap(page: Page, project: string) {
  if (project === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "Map" }).click();
  } else {
    await page.goto("/places");
  }
  await expect(page.getByTestId("map-view")).toBeVisible();
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: process.env.DEMO_URL ?? "http://127.0.0.1:8000" });
  await signIn(page);
  await setMode(page, "online", null);
  await page.close();
});

test("OSM mode: no tile request until the map opens, then only to tile.openstreetmap.org", async ({ page }, info) => {
  await page.route(`https://${TILE_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await signIn(page);
  await setMode(page, "online", null);
  await page.reload();
  const seen = watch(page);

  // Library, Albums and People never touch the tile host.
  if (info.project.name === "desktop") {
    await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
  } else {
    await expect(page.getByRole("tab", { name: "Years", exact: true })).toBeVisible();
  }
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "People & Pets" }).click();
    await page.waitForLoadState("networkidle");
  }
  expect(seen.tiles).toEqual([]);

  await openMap(page, info.project.name);
  await expect.poll(() => seen.tiles.length).toBeGreaterThan(0);
  expect(seen.tiles.every((u) => /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(u))).toBe(true);
  const link = page.getByRole("link", { name: "© OpenStreetMap contributors" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  // Clusters are drawn on top.
  await expect(page.locator(".map-pin").first()).toBeVisible();
  expect(seen.external).toEqual([]);
  expect(seen.problems).toEqual([]);
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-map-online.png` });
});

test("Off mode: clusters on a blank background, no tile request", async ({ page }, info) => {
  await page.route(`https://${TILE_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await signIn(page);
  await setMode(page, "off", null);
  await page.reload();
  const seen = watch(page);
  await openMap(page, info.project.name);
  await expect(page.locator(".map-pin").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(seen.tiles).toEqual([]);
  expect(seen.external).toEqual([]);
  expect(seen.problems).toEqual([]);
  await expect(page.getByRole("link", { name: /OpenStreetMap/ })).toHaveCount(0);
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-map-off.png` });
});

test("Local file mode reads the archive from this server and never calls OSM; a missing file is blank, not OSM", async ({ page }, info) => {
  await page.route(`https://${TILE_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await signIn(page);
  // A stub archive: just enough for the server to accept it. The client
  // cannot parse it and falls back to the blank background.
  const file = join(mkdtempSync(join(tmpdir(), "pm-")), "stub.pmtiles");
  writeFileSync(file, Buffer.concat([Buffer.from("PMTiles"), Buffer.alloc(200)]));
  await setMode(page, "local_file", file);
  await page.reload();
  const seen = watch(page);
  const archive = page.waitForRequest((r) => r.url().endsWith("/api/map/tiles.pmtiles"));
  await openMap(page, info.project.name);
  const request = await archive;
  expect(request.headers()["range"]).toMatch(/^bytes=/);
  await expect(page.locator(".map-pin").first()).toBeVisible();

  await setMode(page, "local_file", `${file}.missing`);
  await page.reload();
  await openMap(page, info.project.name);
  await expect(page.locator(".map-pin").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(seen.tiles).toEqual([]);
  expect(seen.external).toEqual([]);
  expect(seen.problems).toEqual([]);
});
