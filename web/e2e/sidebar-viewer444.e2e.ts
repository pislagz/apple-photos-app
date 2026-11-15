import { expect, test } from "@playwright/test";

// #444: the sidebar and its toggle survive opening the viewer on desktop widths.
// #445: toolbar titles are regular weight.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/k444";

const cases = [
  { scheme: "light", width: 1440 },
  { scheme: "dark", width: 1440 },
  { scheme: "light", width: 1024 },
  { scheme: "dark", width: 1024 },
] as const;

for (const c of cases) {
  test.describe(`${c.scheme}-${c.width}`, () => {
    test.use({ colorScheme: c.scheme, viewport: { width: c.width, height: 800 } });

    test("sidebar stays open in the viewer, toggle works, state survives close", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await page.goto("/");
      await page.getByLabel("Username").fill(USER.username);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByLabel("Username")).toHaveCount(0);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const toggle = page.locator(".sidebar-toggle");
      const collapsed = page.locator(".shell--sidebar-collapsed");
      await expect(collapsed).toHaveCount(0);
      await expect(toggle).toBeVisible();
      const weight = async (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontWeight);
      expect(await weight(".desktop-library__title")).toBe("400");
      await page.screenshot({ path: `${SHOTS}/grid-open-${c.scheme}-${c.width}.png` });

      await page.locator('[data-testid="library-cell"]').nth(2).dblclick();
      await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      await expect(collapsed).toHaveCount(0);
      await expect(page.locator("aside.sidebar")).toBeVisible();
      await expect(toggle).toBeVisible();
      expect(await weight(".desktop-viewer__title-primary")).toBe("400");
      const side = (await page.locator("aside.sidebar").boundingBox())!;
      const viewer = (await page.getByTestId("desktop-viewer").boundingBox())!;
      expect(viewer.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
      await page.screenshot({ path: `${SHOTS}/viewer-open-${c.scheme}-${c.width}.png` });

      // Toggle closes and reopens the sidebar from inside the viewer.
      await toggle.click();
      await expect(collapsed).toHaveCount(1);
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(collapsed).toHaveCount(0);

      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
      await expect(collapsed).toHaveCount(0);
      await expect(page.locator("aside.sidebar")).toBeVisible();

      // Closed sidebar stays closed through open/close of the viewer.
      await toggle.click();
      await expect(collapsed).toHaveCount(1);
      await page.locator('[data-testid="library-cell"]').nth(2).dblclick();
      await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      await expect(collapsed).toHaveCount(1);
      await expect(toggle).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
      await expect(collapsed).toHaveCount(1);
    });
  });
}
