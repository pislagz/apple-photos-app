import { type Page, expect, test } from "@playwright/test";

// #482: selecting + downloading must not shift the grid; progress is a toolbar ring.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e-shots-482";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("desktop: no layout shift while downloading a selection", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  const cells = page.locator('[data-testid="library-cell"]');
  await expect(cells.first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/1-before.png` });
  // Slow the zip so the progress state is observable.
  await page.route("**/zip*", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  const box = async () => ({
    cell: await cells.nth(5).boundingBox(),
    bar: await page.locator(".desktop-library__toolbar, .shell__toolbar-controls").first().boundingBox(),
    seg: await page.locator(".segmented-control").boundingBox(),
  });
  await cells.nth(0).click();
  await cells.nth(1).click({ modifiers: ["Meta"] }).catch(() => {});
  await cells.nth(2).click({ modifiers: ["Control"] });
  await page.waitForTimeout(300);
  const before = await box();
  await page.screenshot({ path: `${OUT}/2-selected.png` });
  await page.locator('button.toolbar-button[title="Download"]').click();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    expect(await box()).toEqual(before);
    if (i === 1) await page.screenshot({ path: `${OUT}/3-downloading.png` });
  }
  await page.screenshot({ path: `${OUT}/3b-toolbar.png`, clip: { x: 500, y: 0, width: 940, height: 60 } });
});
