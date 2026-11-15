import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// #369: desktop "Filter By: All Items" pill floating over the grid.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "./screenshots/369";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("desktop filter pill shows, opens the menu and updates its value", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  mkdirSync(SHOTS, { recursive: true });
  await signIn(page);
  const pill = page.getByRole("button", { name: "Filter By" });
  await expect(pill).toHaveText("Filter By: All Items");
  // Over the grid, not in the header toolbar.
  const grid = (await page.getByTestId("desktop-library-grid").boundingBox())!;
  const box = (await pill.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(grid.y);
  expect(box.y + box.height).toBeLessThan(grid.y + 60);
  expect(box.x + box.width).toBeGreaterThan(grid.x + grid.width - 80);
  await page.screenshot({ path: `${SHOTS}/desktop-pill-${info.project.name}.png` });
  await pill.click();
  const menu = page.getByRole("menu", { name: "Filter By" });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop-pill-open.png` });
  await menu.getByRole("menuitemradio", { name: /Favorites/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(pill).toHaveText("Filter By: Favorites");
  await page.screenshot({ path: `${SHOTS}/desktop-pill-favorites.png` });
});
