import { expect, test } from "@playwright/test";

const USER = { username: "demo-user", password: "demo-user-pass-1" };
const INSET = 59;

for (const width of [390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Years, Months and Days start at the same height under the clock, ${width}px ${scheme} (#446)`, async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "iPhone layout only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await page.getByLabel("Username").fill(USER.username);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.locator("[data-asset-id]").first()).toBeVisible();
      await page.evaluate((px) => document.documentElement.style.setProperty("--safe-top", `${px}px`), INSET);
      await page.setViewportSize({ width, height: 844 });
      const tops: number[] = [];
      for (const name of ["Years", "Months", "Days"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByTestId("period-grid-header")).toContainText(name);
        const scroll = page.getByTestId("library-scroll");
        await expect.poll(async () => scroll.evaluate((el) => ((el.scrollTop = 0), el.scrollTop))).toBe(0);
        await page.waitForTimeout(300);
        tops.push(await page.locator(".period-grid__title").evaluate((el) => el.getBoundingClientRect().top));
        if (width === 390) await page.screenshot({ path: `e2e/screenshots/k446/${name.toLowerCase()}-${scheme}.png` });
      }
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
      expect(tops[0]).toBeGreaterThanOrEqual(INSET);
    });
  }
}

test("standalone display mode keeps the same title inset (#446)", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "iPhone layout only");
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-asset-id]").first()).toBeVisible();
  await page.getByRole("tab", { name: "Years", exact: true }).click();
  await expect(page.getByTestId("period-grid-header")).toContainText("Years");
  const padding = await page.getByTestId("library-scroll").evaluate((el) => getComputedStyle(el).paddingTop);
  expect(padding).not.toBe("0px");
});
