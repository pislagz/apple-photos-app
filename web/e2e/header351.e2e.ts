import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// #351: the iPhone Library header. The Filter button is a glass circle like
// Select, both sit at the trailing inset, and nothing scrolls sideways.
// #352: the menu opened by Filter, in both colour schemes. Shots go to
// SHOTS_DIR (default ./screenshots/p351, not committed).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "./e2e/screenshots/p351";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const width of [320, 375, 430]) {
  test(`header buttons and no sideways scroll at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "one phone project; the width is set here");
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    const filter = page.getByRole("button", { name: "Filter", exact: true });
    const select = page.getByRole("button", { name: "Select", exact: true });
    await expect(filter).toBeVisible();
    const f = (await filter.boundingBox())!;
    const s = (await select.boundingBox())!;
    // iOS trailing inset: 16 px from the right edge, Select last.
    expect(width - (s.x + s.width)).toBeGreaterThanOrEqual(15);
    expect(width - (s.x + s.width)).toBeLessThanOrEqual(17);
    expect(f.x + f.width).toBeLessThanOrEqual(s.x - 4);
    // Same height as Select; a round button.
    expect(f.height).toBe(s.height);
    expect(f.width).toBe(f.height);
    const glass = (locator: typeof filter) =>
      locator.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { blur: cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter"), bg: cs.backgroundColor };
      });
    const fg = await glass(filter);
    expect(fg).toEqual(await glass(select));
    // The blur itself is asserted on the stylesheet in headerGlass.test.ts: the
    // minified build only keeps the -webkit- spelling, which headless Chromium
    // does not report.
    expect(fg.bg).not.toBe("rgba(0, 0, 0, 0)");

    for (const tab of ["Years", "Months", "Days", "All Photos"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>("[data-testid=library-scroll]")!;
        const doc = document.documentElement;
        doc.scrollLeft = 60;
        scroll.scrollLeft = 60;
        return {
          docOver: doc.scrollWidth - doc.clientWidth,
          scrollOver: scroll.scrollWidth - scroll.clientWidth,
          docLeft: doc.scrollLeft,
          scrollLeft: scroll.scrollLeft,
        };
      });
      expect(r, tab).toEqual({ docOver: 0, scrollOver: 0, docLeft: 0, scrollLeft: 0 });
    }
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`#351/#352 screenshots, ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "375 px phone shots");
    mkdirSync(SHOTS, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${scheme}-1-header.png`, clip: { x: 0, y: 0, width: 375, height: 160 } });
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${scheme}-2-menu.png` });
    await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${scheme}-3-filter.png` });
    await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
    await page.getByRole("menuitem", { name: "View Options" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${scheme}-4-view-options.png` });
  });
}
