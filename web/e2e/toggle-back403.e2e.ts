import { expect, test } from "@playwright/test";

// #403: the sidebar toggle and the viewer's Back chevron sit side by side.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/403";

const cases = [
  { scheme: "light", width: 1440, name: "wide-light" },
  { scheme: "dark", width: 1440, name: "wide-dark" },
  { scheme: "light", width: 1000, name: "narrow-light" },
  { scheme: "dark", width: 1000, name: "narrow-dark" },
] as const;

for (const c of cases) {
  test.describe(c.name, () => {
    test.use({ colorScheme: c.scheme, viewport: { width: c.width, height: 800 } });

    test("toggle and Back do not overlap and both work", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "desktop viewer only");
      await page.goto("/");
      await page.getByLabel("Username").fill(USER.username);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByLabel("Username")).toHaveCount(0);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const open = async () => {
        await page.locator('[data-testid="library-cell"]').nth(2).dblclick();
        await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      };
      const check = async () => {
        const toggle = page.locator(".sidebar-toggle");
        const back = page.getByRole("button", { name: "Back" });
        const t = (await toggle.boundingBox())!;
        const b = (await back.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(t.x + t.width + 4);
        expect(Math.abs(t.y + t.height / 2 - (b.y + b.height / 2))).toBeLessThanOrEqual(1);
        // Both are the topmost element at their centres, i.e. clickable.
        for (const [el, box] of [["sidebar-toggle", t], ["desktop-viewer__back", b]] as const) {
          const hit = await page.evaluate(
            ([x, y]) => (() => { const e = document.elementFromPoint(x, y); return e?.closest("button")?.className ?? `NOBTN:${e?.tagName}.${e?.className}`; })(),
            [box.x + box.width / 2, box.y + box.height / 2],
          );
          expect(hit).toContain(el);
        }
      };

      await open();
      await check();
      await page.screenshot({ path: `${SHOTS}/${c.name}.png` });

      if (c.width > 1100) {
        const toggle = page.locator(".sidebar-toggle");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await check();
        await page.screenshot({ path: `${SHOTS}/${c.name}-sidebar-hidden.png` });
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      }

      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
      await open();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
    });
  });
}
