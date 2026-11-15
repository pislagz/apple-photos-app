import { type Page, expect, test } from "@playwright/test";

// #368: narrow desktop windows. No toolbar item overlaps another, the sidebar
// hides itself below the threshold and comes back as the user left it.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/368";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function toolbarBoxes(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".shell__toolbar");
    if (!bar) return [];
    const out: { name: string; l: number; r: number; t: number; b: number }[] = [];
    const sel = "button, input, .segmented-control, .search-box--desktop";
    for (const el of Array.from(bar.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest(".segmented-control") && !el.classList.contains("segmented-control")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.matches(".search-box--desktop input, .search-box--desktop button")) continue;
      out.push({ name: el.getAttribute("aria-label") ?? el.className, l: r.left, r: r.right, t: r.top, b: r.bottom });
    }
    const toggle = document.querySelector<HTMLElement>(".sidebar-toggle");
    if (toggle) {
      const r = toggle.getBoundingClientRect();
      out.push({ name: "sidebar-toggle", l: r.left, r: r.right, t: r.top, b: r.bottom });
    }
    return out;
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`toolbar never overlaps and the sidebar auto-hides (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    const shell = page.locator(".shell--desktop");
    await expect(shell).not.toHaveClass(/shell--sidebar-collapsed/);
    await expect(page.locator(".shell__toolbar .segmented-control")).toBeVisible({ timeout: 20000 });

    for (const width of [1200, 1100, 1024, 990, 980, 960, 900, 820, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(450);
      const narrow = width < 980;
      if (narrow) await expect(shell).toHaveClass(/shell--sidebar-collapsed/);
      else await expect(shell).not.toHaveClass(/shell--sidebar-collapsed/);
      await expect(page.locator(".sidebar-toggle")).toBeEnabled();
      await expect(page.locator(".desktop-library__zoom-slider input[type=range]")).toBeVisible();
      const boxes = await toolbarBoxes(page);
      expect(boxes.length).toBeGreaterThan(3);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
          expect(overlap, `${a.name} overlaps ${b.name} at ${width}px`).toBe(false);
        }
      }
      if ([1100, 900, 768].includes(width)) await page.screenshot({ path: `${SHOTS}/toolbar-${width}-${scheme}.png` });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(450);
    await expect(shell).not.toHaveClass(/shell--sidebar-collapsed/);
    await page.screenshot({ path: `${SHOTS}/restored-${scheme}.png` });
  });
}

test("a sidebar the user closed stays closed after narrow and wide again; the narrow overlay does not touch the choice", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const shell = page.locator(".shell--desktop");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(shell).toHaveClass(/shell--sidebar-collapsed/);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator(".sidebar-toggle")).toBeEnabled();
  await page.keyboard.press("Control+Alt+s");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(shell).toHaveClass(/shell--sidebar-collapsed/);
  await page.keyboard.press("Control+Alt+s");
  await expect(shell).not.toHaveClass(/shell--sidebar-collapsed/);
  // Open when narrowed, open again when wide; the toggle does nothing narrow.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(shell).toHaveClass(/shell--sidebar-collapsed/);
  await page.keyboard.press("Control+Alt+s");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(shell).not.toHaveClass(/shell--sidebar-collapsed/);
});
