import { type Page, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// #374 experiment: dark-map variants. Needs network to tile.openstreetmap.org
// (a handful of tiles per shot). Not part of CI.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const DIR = "e2e/screenshots/374";
const VIEWS = { city: { center: [-0.1276, 51.5072], zoom: 14 }, country: { center: [10.4, 51.1], zoom: 6 } };

async function shoot(page: Page, project: string, scheme: "dark" | "light", variant: number, view: keyof typeof VIEWS) {
  await page.emulateMedia({ colorScheme: scheme });
  const t0 = Date.now();
  await page.goto(`/${project === "desktop" ? "" : "places"}?mapdark=${variant}`);
  if (await page.getByLabel("Username").count()) {
    await page.getByLabel("Username").fill(ADMIN.username);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Username")).toHaveCount(0);
  }
  if (project === "desktop") await page.locator("aside.sidebar").getByRole("button", { name: "Map" }).click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.locator(".map-pin").first()).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => !!(window as unknown as { __osmMap?: unknown }).__osmMap);
  await page.evaluate(
    ([c, z]) => {
      const m = (window as unknown as { __osmMap: { jumpTo: (o: unknown) => void } }).__osmMap;
      m.jumpTo({ center: c, zoom: z });
    },
    [VIEWS[view].center, VIEWS[view].zoom] as const,
  );
  await page.waitForFunction(() => (window as unknown as { __osmMap: { areTilesLoaded: () => boolean } }).__osmMap.areTilesLoaded(), null, { timeout: 30000 });
  const ms = Date.now() - t0;
  await page.waitForTimeout(700);
  const file = `${DIR}/${project}-${scheme}-v${variant}-${view}.png`;
  await page.screenshot({ path: file });
  console.log(`SHOT ${file} ${ms}ms`);
}

test("dark map variants", async ({ page }, info) => {
  test.setTimeout(240000);
  mkdirSync(DIR, { recursive: true });
  const project = info.project.name;
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const cur = await (await page.request.get("/api/admin/settings")).json();
  await page.request.put("/api/admin/settings", { data: { ...cur, osm_consent: true } });
  const plan = (process.env.PLAN ?? "dark:1,dark:2,dark:3,light:1").split(",");
  for (const item of plan) {
    const [scheme, v] = item.split(":");
    for (const view of ["city", "country"] as const) await shoot(page, project, scheme as "dark" | "light", Number(v), view);
  }
});
