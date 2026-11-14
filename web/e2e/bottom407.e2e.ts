import { type Page, expect, test } from "@playwright/test";

// #407: the tab bar reaches the bottom edge and nothing paints black under it.
// Playwright has no real standalone mode or safe area: display-mode is not
// emulable, so the inset is simulated through --safe-bottom.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/407";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone viewport only");
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 20000 });
}

for (const scheme of ["light", "dark"] as const) {
  test(`#407 tab bar bottom == viewport bottom, inset covered (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--safe-bottom", "34px"));
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const bar = document.querySelector(".tab-bar") as HTMLElement;
      const r = bar.getBoundingClientRect();
      const cs = getComputedStyle(bar);
      return {
        bottom: r.bottom,
        vh: window.innerHeight,
        padBottom: parseFloat(cs.paddingBottom),
        bg: cs.backgroundColor,
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        docH: document.documentElement.scrollHeight,
      };
    });
    expect(Math.abs(m.bottom - m.vh)).toBeLessThanOrEqual(1);
    expect(m.padBottom).toBeGreaterThanOrEqual(34);
    expect(m.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(m.docH).toBeLessThanOrEqual(m.vh);
    const expected = scheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
    expect(m.html).toBe(expected);
    expect(m.body).toBe(expected);
    await page.screenshot({ path: `${SHOTS}/iphone-${scheme}.png` });
  });
}
