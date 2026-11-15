import { type Page, expect, test } from "@playwright/test";

// #372: desktop viewer top bar vs Mac Photos, light and dark. Crops the bar.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = `e2e/screenshots/372/${process.env.SHOT_TAG ?? "after"}`;

async function openViewer(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  const cell = page.locator('[data-testid="library-cell"]').nth(3);
  await expect(cell).toBeVisible();
  await cell.dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
}

for (const scheme of ["light", "dark"] as const) {
  test(`bar shot ${scheme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openViewer(page);
    await page.mouse.move(700, 500);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/viewer-${scheme}.png` });
    await page.screenshot({ path: `${OUT}/bar-${scheme}.png`, clip: { x: 0, y: 0, width: 1440, height: 60 } });
  });
}
