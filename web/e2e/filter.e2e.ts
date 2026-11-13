import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// T8/T9: the Filter menu on iPhone and desktop, with screenshots of the open
// menu. SHOTS_DIR overrides where they go.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "./screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("desktop Filter By menu", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  mkdirSync(SHOTS, { recursive: true });
  await signIn(page);
  await page.getByRole("button", { name: "Filter By" }).click();
  const menu = page.getByRole("menu", { name: "Filter By" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(8);
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/desktop-filter-menu.png` });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.getByRole("button", { name: "Filter By" }).click();
  await menu.getByRole("menuitemradio", { name: /Videos/ }).click();
  await expect(page.getByRole("button", { name: "Filter By" })).toHaveAttribute("data-active", "true");
  await page.screenshot({ path: `${SHOTS}/desktop-filtered-videos.png` });
});

test("iPhone Filter menu", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "iphone layout only");
  mkdirSync(SHOTS, { recursive: true });
  await signIn(page);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Filter/ }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(8);
  await page.getByRole("menuitem", { name: /View Options/ }).click();
  await page.screenshot({ path: `${SHOTS}/iphone-filter-menu.png` });
  await page.getByRole("menuitemradio", { name: /Favorites/ }).click();
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveAttribute("data-active", "true");
  await page.screenshot({ path: `${SHOTS}/iphone-filtered-favorites.png` });
});
