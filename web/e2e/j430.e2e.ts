import { type Page, expect, test } from "@playwright/test";

// #430 sidebar toggle in the viewer only where it works; #434 one desktop
// toolbar for grid and viewer. Screenshots go to e2e/screenshots/j430.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/j430";

async function openGrid(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  // Below 980px the sidebar is hidden and Library is already the start view.
  if (await page.locator("aside.sidebar").isVisible()) await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"]').nth(3)).toBeVisible();
}

async function openViewer(page: Page) {
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
}

for (const [name, width] of [["wide", 1440], ["mid", 1024], ["narrow", 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${name}-${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 800 } });

      test("shared toolbar and toggle visibility", async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        await openGrid(page);
        const gridBar = page.getByTestId("shell-toolbar");
        const gridBox = (await gridBar.boundingBox())!;
        const gridStyle = await gridBar.evaluate((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, border: s.borderBottomColor, w: s.borderBottomWidth };
        });
        await page.screenshot({ path: `${SHOTS}/${name}-${scheme}-grid.png` });

        await openViewer(page);
        const bar = page.locator(".desktop-viewer__topbar");
        const barBox = (await bar.boundingBox())!;
        // Same height, same look.
        expect(Math.round(barBox.height)).toBe(Math.round(gridBox.height));
        expect(barBox.height).toBe(52);
        const barStyle = await bar.evaluate((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, border: s.borderBottomColor, w: s.borderBottomWidth };
        });
        expect(barStyle).toEqual(gridStyle);

        // Same zoom slider component, same buttons and labels.
        const viewer = page.getByTestId("desktop-viewer");
        await expect(bar.locator(".desktop-library__zoom-slider")).toHaveCount(1);
        const slider = page.getByTestId("viewer-zoom-slider");
        await expect(slider).toBeVisible();
        await viewer.getByRole("button", { name: "Zoom In" }).click();
        expect(Number(await slider.inputValue())).toBeGreaterThan(1);
        await viewer.getByRole("button", { name: "Zoom Out" }).click();
        expect(Number(await slider.inputValue())).toBe(1);

        // #430
        const toggle = page.locator(".sidebar-toggle");
        const back = viewer.getByRole("button", { name: "Back" });
        // The sidebar auto-hides below 980px; only there does the toggle (an overlay) do anything.
        if (width >= 980) {
          await expect(toggle).toBeHidden();
        } else {
          await expect(toggle).toBeVisible();
          await toggle.click();
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator("aside.sidebar")).toBeVisible();
          // The open overlay sits over the toggle; a click outside closes it.
          await page.getByTestId("viewer-title").click();
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
        }
        await expect(back).toBeVisible();
        await page.mouse.move(700, 500);
        await page.screenshot({ path: `${SHOTS}/${name}-${scheme}-viewer.png` });
        await back.click();
        await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
      });
    });
  }
}
