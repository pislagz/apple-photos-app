import { type Page, expect, test } from "@playwright/test";
import { cropElement } from "./crop";

// #236: web giveaways removed; screenshots in light and dark for the
// side-by-side check against the reference.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/p236";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test("login screenshot", async ({ page }, info) => {
      await page.goto("/");
      await page.screenshot({ path: `${SHOTS}/login-${info.project.name}-${scheme}.png` });
    });

    test("chrome is native-feeling", async ({ page }, info) => {
      test.skip(info.project.name === "small", "desktop and iPhone only");
      const mobile = info.project.name === "iphone";
      await login(page);
      const tile = page.locator(mobile ? ".mobile-library__cell" : "[data-testid=library-cell] img").first();
      await expect(tile).toBeVisible();

      const style = (sel: string, prop: string) =>
        page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      expect(await style("html", "overscroll-behavior")).toContain("none");
      expect(await style("button", "cursor")).toBe("default");
      expect(await style("button", "user-select")).toBe("none");
      expect(await tile.evaluate((el) => (el as HTMLImageElement).draggable)).toBe(false);
      const html = await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
      expect(html).toBe(true);

      await page.screenshot({ path: `${SHOTS}/grid-${info.project.name}-${scheme}.png` });
      await cropElement(page, mobile ? ".tab-bar" : ".sidebar", `crop-${mobile ? "tabbar" : "sidebar"}-${scheme}`, {
        width: 240,
        height: 120,
      });
      await cropElement(page, "button", `crop-button-${info.project.name}-${scheme}`, { width: 160, height: 60 });
    });
  });
}
