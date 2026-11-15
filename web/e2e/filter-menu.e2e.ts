import { type Page, expect, test } from "@playwright/test";

// #352: the iPhone Filter menu opens and closes reliably, expands in place,
// and does not let a tap through to the grid.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test.describe("iPhone Filter menu", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone layout only");
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
  });

  test("one tap opens, button or outside tap closes, and the grid gets nothing", async ({ page }) => {
    const button = page.getByRole("button", { name: "Filter", exact: true });
    const menu = page.getByRole("menu", { name: "Filter" });
    await button.tap();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await expect(page.getByText(/sort by/i)).toHaveCount(0);
    await button.tap();
    await expect(menu).toHaveCount(0);
    await button.tap();
    await expect(menu).toBeVisible();
    // A tap on a photo behind the menu only closes it: no viewer opens.
    await page.touchscreen.tap(60, 500);
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(button).toBeVisible();
    await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toBeVisible();
  });

  test("Filter expands in place and a pick filters the grid", async ({ page }) => {
    await page.getByRole("button", { name: "Filter", exact: true }).tap();
    const menu = page.getByRole("menu", { name: "Filter" });
    await menu.getByRole("menuitem", { name: "Filter", exact: true }).tap();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(8);
    await expect(menu.getByRole("menuitemradio", { name: "All Items" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitem", { name: "Filter", exact: true }).tap();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Filter", exact: true }).tap();
    await menu.getByRole("menuitemradio", { name: "Favorites" }).tap();
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveAttribute("data-active", "true");
    await page.getByRole("button", { name: "Filter", exact: true }).tap();
    await menu.getByRole("menuitem", { name: "Filter", exact: true }).tap();
    await expect(menu.getByRole("menuitemradio", { name: "Favorites" })).toHaveAttribute("aria-checked", "true");
  });

  test("View Options: zoom, aspect ratio and the Show: ticks", async ({ page }) => {
    await page.getByRole("button", { name: "Filter", exact: true }).tap();
    const menu = page.getByRole("menu", { name: "Filter" });
    await menu.getByRole("menuitem", { name: "View Options" }).tap();
    await expect(menu.getByText("Show:")).toBeVisible();
    const shots = menu.getByRole("menuitemcheckbox", { name: "Screenshots" });
    const shared = menu.getByRole("menuitemcheckbox", { name: "Shared with You" });
    await expect(shots).toHaveAttribute("aria-checked", "true");
    await shots.tap();
    await expect(shots).toHaveAttribute("aria-checked", "false");
    await expect(shared).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveAttribute("data-active", "true");
    const aspect = menu.getByRole("menuitemcheckbox", { name: "Aspect Ratio Grid" });
    await aspect.tap();
    await expect(aspect).toHaveAttribute("aria-checked", "true");
    const before = await page.locator(".mobile-library__cell").first().evaluate((el) => el.getBoundingClientRect().width);
    await menu.getByRole("menuitem", { name: "Zoom In" }).tap();
    await expect
      .poll(() => page.locator(".mobile-library__cell").first().evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(before);
  });

  test("the menu stays on screen and works from the keyboard", async ({ page }) => {
    const button = page.getByRole("button", { name: "Filter", exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Filter" });
    await expect(menu.getByRole("menuitem", { name: "Filter", exact: true })).toBeFocused();
    const box = (await menu.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Enter");
    await expect(menu.getByRole("menuitem", { name: "Filter", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: "Favorites" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});
