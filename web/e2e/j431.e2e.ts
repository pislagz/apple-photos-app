import { expect, test } from "@playwright/test";

const USER = { username: "demo-user", password: "demo-user-pass-1" };
const INSET = 59; // iPhone Dynamic Island class safe-area-inset-top

for (const scheme of ["light", "dark"] as const) {
  test(`large title sits just below the safe area, ${scheme} (#431)`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("[data-asset-id]").first()).toBeVisible();
    await page.evaluate((px) => document.documentElement.style.setProperty("--safe-top", `${px}px`), INSET);
    await page.setViewportSize({ width: 390, height: 800 });
    for (const name of ["Years", "Months", "Days", "All Photos"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      const scroll = page.getByTestId("library-scroll");
      await expect
        .poll(async () => scroll.evaluate((el) => ((el.scrollTop = 0), el.scrollTop)), { timeout: 5000 })
        .toBe(0);
      await page.waitForTimeout(300);
      const sel = {
        Years: ".period-card",
        Months: "[data-testid='period-month-header']",
        Days: ".period-grid__title",
        "All Photos": "[data-testid='header-title']",
      }[name]!;
      const m = await page.evaluate((q) => {
        const t = document.querySelector<HTMLElement>(q)!;
        const r = document.createRange();
        r.selectNodeContents(t);
        return { text: r.getBoundingClientRect().top || t.getBoundingClientRect().top };
      }, sel);
      console.log(scheme, name, JSON.stringify(m));
      expect(m.text, `${name} title below the clock`).toBeGreaterThanOrEqual(INSET);
      expect(m.text, `${name} title not far below the inset`).toBeLessThanOrEqual(INSET + (name === "Years" || name === "Months" ? 62 : 24));
      await page.screenshot({ path: `e2e/screenshots/j431/${name.replace(" ", "-").toLowerCase()}-${scheme}.png` });
    }
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`theme-color follows the appearance, ${scheme} (#432)`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("[data-asset-id]").first()).toBeVisible();
    const bg = () =>
      page.evaluate(() => {
        const rgb = getComputedStyle(document.documentElement).backgroundColor;
        const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
        return { rgb, metas: metas.map((m) => [m.content, m.media]) };
      });
    console.log(scheme, JSON.stringify(await bg()));
    const active = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
        .filter((m) => !m.media || matchMedia(m.media).matches)
        .map((m) => m.content),
    );
    expect(active).toEqual([scheme === "light" ? "#ffffff" : "#000000"]);
    await page.emulateMedia({ colorScheme: scheme === "light" ? "dark" : "light" });
    await page.waitForTimeout(200);
    const flipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
        .filter((m) => !m.media || matchMedia(m.media).matches)
        .map((m) => m.content),
    );
    expect(flipped).toEqual([scheme === "light" ? "#000000" : "#ffffff"]);
  });
}
