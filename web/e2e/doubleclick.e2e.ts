import { expect, test } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

test("desktop opens on All Photos and a double-click right after a selection opens the photo (#265)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const cells = page.locator('[data-testid="library-cell"]');
  await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(cells.first()).toBeVisible();

  await cells.nth(0).click();
  await cells.nth(2).dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await page.getByLabel("Close").click();
  await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);

  await cells.nth(1).dblclick({ delay: 30 });
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
});
