import { expect, test } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const INSET = 47; // iPhone Dynamic Island class safe-area-inset-top

for (const scheme of ["light", "dark"] as const) {
  test(`phone Library views share one top offset below the safe area, ${scheme} (#414 #415)`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("[data-asset-id]").first()).toBeVisible();
    // env() cannot be faked in Chromium; every phone header reads --safe-top.
    await page.evaluate((px) => document.documentElement.style.setProperty("--safe-top", `${px}px`), INSET);
    await page.setViewportSize({ width: 390, height: 800 }); // re-measure the inset probe

    const tops: Record<string, number> = {};
    for (const name of ["Years", "Months", "Days", "All Photos"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      const scroll = page.getByTestId("library-scroll");
      await expect(scroll.locator("img, [data-testid='period-month-header'], h1").first()).toBeVisible();
      await scroll.evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>("[data-testid='library-scroll']")!;
        const first = scroller.querySelector<HTMLElement>(
          "[data-testid='period-grid-header'], [data-testid='period-month-header'], .period-card, [data-asset-id]",
        )!;
        // Header bottom = lowest control / title in the floating top bar, if any.
        const bar = document.querySelector("[data-testid='top-bar']");
        const parts = bar ? [...bar.querySelectorAll<HTMLElement>(".mobile-library__title-block, button")] : [];
        const headerBottom = parts.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0);
        return { top: first.getBoundingClientRect().top, headerBottom };
      });
      tops[name] = m.top;
      expect(m.top, `${name} first content below the inset`).toBeGreaterThanOrEqual(INSET);
      expect(m.top, `${name} clear of the header`).toBeGreaterThan(m.headerBottom);
      await page.screenshot({ path: `e2e/screenshots/414/${name.replace(" ", "-").toLowerCase()}-${scheme}.png` });
    }
    const values = Object.values(tops);
    expect(Math.max(...values) - Math.min(...values), JSON.stringify(tops)).toBeLessThanOrEqual(1);
  });
}
