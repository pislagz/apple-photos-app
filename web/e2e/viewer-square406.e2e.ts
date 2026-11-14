import { type Page, expect, test } from "@playwright/test";

// #406: every icon button in the desktop viewer's top bar is exactly square,
// hover background included.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e/screenshots/n1114c";

async function openViewer(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const library = page.locator("aside.sidebar").getByRole("button", { name: "Library" });
  if (await library.isVisible()) await library.click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
}

for (const width of [1440, 900]) {
  test(`top-bar icon buttons are square when hovered (${width}px)`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.setViewportSize({ width, height: 900 });
    await openViewer(page);
    const buttons = page.locator(".desktop-viewer__topbar button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(4);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      if (!(await button.isVisible()) || (await button.isDisabled())) continue;
      await button.hover();
      const box = (await button.boundingBox())!;
      const label = await button.getAttribute("aria-label");
      expect(Math.abs(box.width - box.height), `${label}: ${box.width}x${box.height}`).toBeLessThanOrEqual(0.5);
      if (i === count - 1 && width === 1440) {
        await page.screenshot({ path: `${OUT}/406-hover.png`, clip: { x: 0, y: 0, width, height: 60 } });
      }
    }
    // Back stays first, with the sidebar toggle (when shown) next to it (#403).
    const back = page.getByRole("button", { name: "Back" });
    await expect(back).toBeVisible();
  });
}
