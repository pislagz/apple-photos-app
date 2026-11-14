import { type Page, expect, test } from "@playwright/test";

// #233: Apple-matched controls; computed styles plus light/dark screenshots.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/p233";

async function login(page: Page, who: { username: string; password: string }, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} desktop`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("login, toolbar, slider, settings", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await page.goto("/");
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-login.png` });
      await login(page, USER);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const btn = page.locator(".toolbar-button").first();
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(Math.round(box!.height)).toBe(28);
      expect(await btn.evaluate((e) => getComputedStyle(e).borderRadius)).toBe("8px");
      const slider = page.getByRole("slider", { name: "Zoom" });
      expect(await slider.evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(20);
      expect(await slider.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(100);
      const search = page.locator(".search-box--desktop");
      expect(Math.round((await search.boundingBox())!.height)).toBe(32);
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-toolbar.png` });
      await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
      await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-viewer.png` });
    });

    test("selection toolbar", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, USER);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const cell = page.locator('[data-testid="library-cell"]').nth(2);
      await cell.click();
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-selection.png` });
    });

    test("admin settings controls", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, ADMIN, "/admin");
      await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      const sw = page.locator("button.admin-switch").first();
      if (await sw.count()) {
        const b = await sw.boundingBox();
        expect([Math.round(b!.width), Math.round(b!.height)]).toEqual([38, 22]);
      }
      const input = page.locator("input.admin-input:not(:disabled)").first();
      if (await input.count()) {
        // The field lives in the collapsed "Advanced" <details>, which cannot take focus until opened.
        await page.locator("details.admin-advanced > summary").click();
        await input.focus();
        await expect(input).toBeFocused();
        expect(await input.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe("none");
      }
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-settings.png` });
    });
  });

  test.describe(`${scheme} iphone`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("login and grid", async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "phone layout only");
      await page.goto("/");
      await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-login.png` });
      await login(page, USER);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-grid.png` });
    });

    test("settings", async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "phone layout only");
      await login(page, ADMIN, "/admin");
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-admin.png` });
    });
  });
}

// Field focus rings are box-shadows, which forced-colors mode drops; a transparent outline stays visible there.
test("focused login field keeps a forced-colors-visible outline", async ({ page }) => {
  await page.goto("/");
  const field = page.getByLabel("Username");
  await field.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const s = await field.evaluate((el) => {
    const c = getComputedStyle(el);
    return { style: c.outlineStyle, width: c.outlineWidth };
  });
  expect(s.style).toBe("solid");
  expect(s.width).toBe("2px");
});
