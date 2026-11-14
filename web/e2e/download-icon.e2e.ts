import { type Page, expect, test } from "@playwright/test";

// #363: close-ups (3x) of every place the download and link icons are drawn.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e/screenshots/363b";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 3 });

    test("desktop: library toolbar and viewer", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await signIn(page);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const cell = page.locator('[data-testid="library-cell"]');
      await cell.nth(3).click();
      const lib = page.locator('button.toolbar-button[title="Download"]');
      await expect(lib.locator("svg")).toBeVisible();
      await page.screenshot({ path: `${OUT}/desktop-${scheme}-library.png`, clip: { x: 700, y: 0, width: 740, height: 70 } });
      await lib.screenshot({ path: `${OUT}/desktop-${scheme}-library-icon.png` });
      await cell.nth(3).dblclick();
      const viewer = page.getByTestId("desktop-viewer");
      await expect(viewer).toBeVisible();
      const dl = viewer.getByRole("button", { name: "Download", exact: true });
      await expect(dl.locator("svg")).toBeVisible();
      await page.locator(".desktop-viewer__topbar-right").screenshot({ path: `${OUT}/desktop-${scheme}-viewer.png` });
      await dl.screenshot({ path: `${OUT}/desktop-${scheme}-viewer-icon.png` });
      const link = viewer.getByRole("button", { name: "Copy Link", exact: true });
      await expect(link.locator("svg")).toBeVisible();
      await link.screenshot({ path: `${OUT}/desktop-${scheme}-viewer-link-icon.png` });
      await page.screenshot({ path: `${OUT}/desktop-${scheme}-viewer-full.png` });
    });

    test("phone: select bar", async ({ page }, info) => {
      test.skip(info.project.name === "desktop", "phone only");
      await signIn(page);
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.locator("img.mobile-library__cell").nth(0).click();
      const bar = page.getByTestId("select-bar");
      await expect(bar.locator("svg").last()).toBeVisible();
      await bar.screenshot({ path: `${OUT}/${info.project.name}-${scheme}-select-bar.png` });
      await page.getByRole("button", { name: "Download", exact: true }).screenshot({
        path: `${OUT}/${info.project.name}-${scheme}-select-icon.png`,
      });
    });

    test("phone: viewer Download Original", async ({ page }, info) => {
      test.skip(info.project.name === "desktop", "phone only");
      await signIn(page);
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      // "Download Original" shows only for edited photos; the demo library has none,
      // so flag the asset detail response as edited.
      await page.route(/\/api\/libraries\/[^/]+\/assets\/[^/?]+$/, async (route) => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: { ...body, has_edited: true } });
      });
      await page.locator("img.mobile-library__cell").nth(0).click();
      const btn = page.getByRole("button", { name: "Download Original" });
      await expect(btn.locator("svg")).toBeVisible();
      await btn.screenshot({ path: `${OUT}/${info.project.name}-${scheme}-viewer-icon.png` });
      await page.screenshot({ path: `${OUT}/${info.project.name}-${scheme}-viewer-full.png` });
    });
  });
}
