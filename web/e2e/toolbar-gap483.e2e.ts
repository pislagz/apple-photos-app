import { expect, test } from "@playwright/test";

// #483: the desktop viewer's right-hand toolbar buttons are evenly spaced.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

test("right toolbar gaps are equal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
  await page.mouse.move(700, 500);
  // #507: Download and its ▾ are one control (.download-menu), so the gaps are between controls.
  const buttons = page.locator(".desktop-viewer__topbar-right > .toolbar-button, .desktop-viewer__topbar-right > .download-menu");
  await expect(buttons.nth(2)).toBeVisible();
  const boxes = await buttons.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right };
    }),
  );
  const gaps = boxes.slice(1).map((b, i) => b.l - boxes[i].r);
  for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThan(0.5);
  await page.locator(".desktop-viewer__topbar-right").screenshot({ path: "e2e-shots-483/right-toolbar.png" });
  await page.screenshot({ path: "e2e-shots-483/viewer.png", clip: { x: 0, y: 0, width: 1440, height: 60 } });
});
