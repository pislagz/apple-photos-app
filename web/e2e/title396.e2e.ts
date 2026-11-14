import { expect, test } from "@playwright/test";

// #396: stepping fast through photos on desktop must not make the viewer
// title blink (empty, or the date-only fallback, or a different colour).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/396";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("title never blinks while stepping fast", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "desktop viewer only");
      // Slow the detail route so each step has a visible loading window.
      await page.route(/\/api\/libraries\/\d+\/assets\/[^/?]+$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        // The synthetic library has no places; give every asset one so the
        // title has a place line to lose while the next detail loads.
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, place: "Oslo", place_address: "Oslo, Norway", place_country_code: "NO" } });
      });
      await page.goto("/");
      await page.getByLabel("Username").fill(USER.username);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByLabel("Username")).toHaveCount(0);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
      await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
      await expect(page.locator(".desktop-viewer__title-primary")).toHaveText("Oslo");
      await page.waitForTimeout(500);
      const before = await page.getByTestId("viewer-title").textContent();

      await page.evaluate(() => {
        const bad: string[] = [];
        const w = window as unknown as { __bad: string[]; __stop: boolean };
        w.__bad = bad;
        const base = getComputedStyle(document.querySelector(".desktop-viewer__title-primary")!).color;
        const tick = () => {
          const title = document.querySelector('[data-testid="viewer-title"]');
          const primary = title?.querySelector(".desktop-viewer__title-primary");
          if (!title || !primary) bad.push("title unmounted");
          else {
            if (!(primary.textContent ?? "").trim()) bad.push("empty primary");
            else if (/ at \d\d:\d\d/.test(primary.textContent ?? "")) bad.push(`date-only fallback: ${primary.textContent}`);
            if (getComputedStyle(primary).color !== base) bad.push(`colour ${getComputedStyle(primary).color}`);
            if (getComputedStyle(title).opacity !== "1") bad.push("title opacity");
            if (getComputedStyle(document.querySelector(".desktop-viewer__topbar")!).opacity !== "1") bad.push("bar opacity");
          }
          if (!w.__stop) requestAnimationFrame(tick);
        };
        tick();
      });
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}/desktop-title-${scheme}.png`, clip: { x: 0, y: 0, width: 1440, height: 80 } });
      const bad = await page.evaluate(() => {
        (window as unknown as { __stop: boolean }).__stop = true;
        return (window as unknown as { __bad: string[] }).__bad;
      });
      expect(bad).toEqual([]);
      await expect(page.getByTestId("viewer-title")).not.toHaveText(before ?? "");
    });
  });
}
