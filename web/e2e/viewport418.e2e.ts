import { type Page, expect, test } from "@playwright/test";

// #418: iOS standalone height fix. Playwright cannot reproduce the iOS bug or
// real standalone mode, so navigator.standalone is faked and we check the
// shell still ends exactly at the viewport bottom with the labels visible.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/418";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone viewport only");
});

async function signIn(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15",
    });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 20000 });
}

for (const scheme of ["light", "dark"] as const) {
  test(`#418 tab bar bottom == viewport bottom, labels visible (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const bar = document.querySelector(".tab-bar") as HTMLElement;
      const r = bar.getBoundingClientRect();
      const labels = [...bar.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && (e.textContent ?? "").trim() !== "")
        .map((e) => e.getBoundingClientRect());
      return {
        bottom: r.bottom,
        vh: window.innerHeight,
        appHeight: document.documentElement.style.getPropertyValue("--app-height"),
        labels: labels.map((l) => ({ top: l.top, bottom: l.bottom, h: l.height })),
      };
    });
    expect(m.appHeight).toMatch(/^\d+px$/);
    expect(Math.abs(m.bottom - m.vh)).toBeLessThanOrEqual(1);
    expect(m.labels.length).toBeGreaterThan(0);
    for (const l of m.labels) {
      expect(l.h).toBeGreaterThan(8);
      expect(l.bottom).toBeLessThanOrEqual(m.vh);
    }
    await page.screenshot({ path: `${SHOTS}/iphone-${scheme}.png` });
  });
}
