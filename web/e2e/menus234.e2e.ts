import { type Page, expect, test } from "@playwright/test";

// #234: Apple-matched menus, context menus, sheets and alerts.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/p234";

async function login(page: Page, who: { username: string; password: string }, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function openAddPersonSheet(page: Page) {
  await login(page, ADMIN, "/admin");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "People" }).click();
  await page.getByRole("button", { name: /Add Person/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} desktop`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("context menu: 12px radius, 5px padding, inset focus ring, Esc closes", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, USER);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.locator('[data-testid="library-cell"]').nth(3).click({ button: "right" });
      const menu = page.locator(".desktop-library__context-menu");
      await expect(menu).toBeVisible();
      const style = await menu.evaluate((e) => {
        const s = getComputedStyle(e);
        return { r: s.borderRadius, p: s.padding, sh: s.boxShadow };
      });
      expect(style.r).toBe("12px");
      expect(style.p).toBe("5px");
      expect(style.sh).toContain("34px");
      await menu.locator("button").first().focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      expect(await menu.locator("button").first().evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe("none");
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-context-menu.png` });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    });

    test("filter menu popup", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, USER);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.locator(".filter-menu--desktop .toolbar-button").first().click();
      const popup = page.locator(".filter-menu__popup");
      await expect(popup).toBeVisible();
      expect(await popup.evaluate((e) => getComputedStyle(e).borderRadius)).toBe("12px");
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-menu.png` });
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    });

    test("admin sheet: material backdrop, 11px radius, Esc and outside click dismiss", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      const sheet = await openAddPersonSheet(page);
      expect(await sheet.evaluate((e) => getComputedStyle(e).borderRadius)).toBe("11px");
      const backdrop = page.locator(".admin-sheet-backdrop");
      expect(await backdrop.evaluate((e) => getComputedStyle(e).backdropFilter)).toContain("blur(15px)");
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-sheet.png` });
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await page.getByRole("button", { name: /Add Person/ }).click();
      await page.mouse.click(5, 5);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  });

  test.describe(`${scheme} iphone`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("sheet is a bottom card on the plain dim backdrop", async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "phone layout only");
      const sheet = await openAddPersonSheet(page);
      await page.waitForTimeout(500);
      const box = (await sheet.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(844);
      const backdrop = page.locator(".admin-sheet-backdrop");
      expect(await backdrop.evaluate((e) => getComputedStyle(e).backdropFilter)).toBe("none");
      await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-sheet.png` });
    });
  });
}
