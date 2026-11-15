import { expect, test, type Page } from "@playwright/test";

// #394: the phone viewer's bottom buttons use the same round glass style as
// the select bar (#382).
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`viewer bottom buttons are round glass buttons (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const cells = page.locator("img.mobile-library__cell");
    await cells.nth(0).click();
    await page.screenshot({ path: `e2e/screenshots/394/${info.project.name}-${scheme}-select-bar.png` });
    await page.getByRole("button", { name: "Cancel" }).click();
    await cells.nth(0).click();
    const share = page.getByRole("button", { name: "Share" });
    await expect(share).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `e2e/screenshots/394/${info.project.name}-${scheme}-viewer-bar.png` });

    const info_ = page.getByRole("button", { name: "Info" });
    for (const b of [share, info_]) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const css = await b.evaluate((el) => {
        const s = getComputedStyle(el);
        return { radius: parseFloat(s.borderTopLeftRadius), bg: s.backgroundColor, cursor: s.cursor };
      });
      expect(css.radius).toBeGreaterThanOrEqual(22);
      expect(css.bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(css.cursor).not.toBe("pointer");
    }
    const bg = await share.evaluate((el) => getComputedStyle(el).backgroundColor);
    const ref = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--glass-button"));
    expect(ref.trim().length).toBeGreaterThan(0);
    expect(bg).toMatch(/^rgba?\(/);
    await info_.click();
    await expect(page.getByTestId("viewer-info-sheet")).toBeVisible();
  });
}
