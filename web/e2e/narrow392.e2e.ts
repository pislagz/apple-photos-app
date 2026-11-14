import { type Page, expect, test } from "@playwright/test";

// #392: zoom slider stays, Ctrl/Cmd+Alt+S toggles, narrow sidebar is an overlay.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/392";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.locator(".shell__toolbar .segmented-control")).toBeVisible({ timeout: 20000 });
}

const sizes = [
  { width: 1440, height: 900 },
  { width: 800, height: 700 },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { width, height } of sizes) {
    test(`slider stays, toggle enabled, overlay behaviour at ${width}x${height} (${scheme})`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height });
      await signIn(page);
      await page.waitForTimeout(450);
      const narrow = width < 980;
      const slider = page.locator(".desktop-library__zoom-slider input[type=range]");
      const toggle = page.locator(".sidebar-toggle");
      const side = page.locator("aside.sidebar");
      const grid = page.locator(".desktop-library__grid");
      await expect(slider).toBeVisible();
      expect((await slider.boundingBox())!.width).toBeGreaterThan(30);
      await expect(toggle).toBeEnabled();
      await page.screenshot({ path: `${SHOTS}/${width}-closed-${scheme}.png` });

      if (!narrow) {
        await page.keyboard.press("Control+Alt+s");
        await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(1);
        await page.keyboard.press("Control+Alt+s");
        await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(0);
        return;
      }

      await expect(side).toBeHidden();
      const gridBefore = await grid.boundingBox();
      // Button opens the overlay; the grid does not move.
      await toggle.click();
      await expect(side).toBeVisible();
      await page.waitForTimeout(400);
      expect(await grid.boundingBox()).toEqual(gridBefore);
      await page.screenshot({ path: `${SHOTS}/${width}-overlay-${scheme}.png` });
      // Click outside closes.
      await page.mouse.click(width - 40, height - 40);
      await expect(side).toBeHidden();
      // Shortcut opens, Escape closes.
      await page.keyboard.press("Control+Alt+s");
      await expect(side).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(side).toBeHidden();
      // Shortcut toggles, choosing an item closes.
      await page.keyboard.press("Control+Alt+s");
      await expect(side).toBeVisible();
      await side.getByRole("button", { name: "Library" }).click();
      await expect(side).toBeHidden();
      await page.keyboard.press("Control+Alt+s");
      await page.keyboard.press("Control+Alt+s");
      await expect(side).toBeHidden();
    });
  }
}
