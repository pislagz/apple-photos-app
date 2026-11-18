import { expect, test, type Page } from "@playwright/test";

// #509: one Download ▾ (grid look) in grid and viewer; the ▾ only when the
// selection / viewed photo has an edited version. Real server; the demo library
// has no edited photos, so "edited" patches the two JSON fields the server
// computes (covered by the server tests). Shots go to web/e2e-shots-n501/.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-n501";
const BAR = { x: 700, y: 0, width: 740, height: 70 };

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "Mac layout");
});

// `folder`: whether the browser can write to a folder (Chrome/Edge) or not (Safari).
async function signIn(page: Page, { folder, edited }: { folder: boolean; edited: boolean }) {
  if (!folder) await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showDirectoryPicker);
  if (edited) {
    await page.route(/\/api\/libraries\/\d+\/assets\/[^/?]+$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), has_edited: true } });
    });
    await page.route(/\/selection-summary$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), edited: 1 } });
    });
  }
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
}

async function viewer(page: Page) {
  await page.locator("[data-asset-id]").first().dblclick();
  await expect(page.locator(".desktop-viewer__topbar-right").getByTestId("download-menu")).toBeVisible();
  await page.waitForTimeout(700);
}
const chevronIn = (page: Page, scope: string) => page.locator(scope).getByRole("button", { name: "More Download Options" });
const menuRows = (page: Page) => page.getByRole("menuitem").allTextContents();

for (const [name, folder, edited] of [
  ["safari-not-edited", false, false],
  ["safari-edited", false, true],
  ["chrome-not-edited", true, false],
  ["chrome-edited", true, true],
] as const) {
  test(`grid + viewer, ${name}`, async ({ page }) => {
    await signIn(page, { folder, edited });
    const wantRows = [...(edited ? ["Download Unmodified Original"] : []), ...(folder ? ["Export to Folder…"] : [])];

    await page.locator("[data-asset-id]").first().click();
    const grid = page.locator(".desktop-library__toolbar, .desktop-library").first();
    await expect(page.getByTestId("download-menu").first()).toBeVisible();
    await page.waitForTimeout(600);
    const gridChevron = chevronIn(page, "body");
    if (wantRows.length === 0) {
      await expect(gridChevron).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/509-grid-${name}.png`, clip: BAR });
    } else {
      await expect(gridChevron).toBeEnabled();
      await gridChevron.click();
      await expect.poll(() => menuRows(page)).toEqual(wantRows);
      await page.screenshot({ path: `${SHOTS}/509-grid-${name}.png`, clip: { ...BAR, height: 130 } });
      await page.keyboard.press("Escape");
    }
    void grid;
    const gridMain = await page.locator(".download-menu__main").first().boundingBox();

    await viewer(page);
    const scope = ".desktop-viewer__topbar-right";
    const main = await page.locator(`${scope} .download-menu__main`).boundingBox();
    expect(main!.width).toBeCloseTo(gridMain!.width, 0);
    expect(main!.height).toBeCloseTo(gridMain!.height, 0);
    if (wantRows.length === 0) {
      await expect(chevronIn(page, scope)).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/509-viewer-${name}.png`, clip: BAR });
    } else {
      await expect(chevronIn(page, scope)).toBeEnabled();
      await chevronIn(page, scope).click();
      await expect.poll(() => menuRows(page)).toEqual(wantRows);
      await page.screenshot({ path: `${SHOTS}/509-viewer-${name}.png`, clip: { ...BAR, height: 130 } });
    }
  });
}
