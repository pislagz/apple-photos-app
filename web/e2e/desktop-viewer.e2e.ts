import { type Page, expect, test } from "@playwright/test";

// #302: the desktop viewer's Mac Photos top bar, in light and dark.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";

async function openViewer(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  const cell = page.locator('[data-testid="library-cell"]').nth(3);
  await expect(cell).toBeVisible();
  await cell.dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
  // pp: the title is the date (and time/place), never a file name.
  await expect(page.getByTestId("viewer-title")).not.toContainText(/\.(jpe?g|heic|png|mov|mp4)\b/i);
}

const position = (page: Page) => page.getByTestId("viewer-title").textContent();

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("top bar layout, zoom controls, keys", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "desktop viewer only");
      await openViewer(page);
      const bar = page.locator(".desktop-viewer__topbar");
      const viewer = page.getByTestId("desktop-viewer");
      const back = viewer.getByRole("button", { name: "Back" });
      const title = page.getByTestId("viewer-title");
      const info = viewer.getByRole("button", { name: "Info" });
      const [b, t, i] = [await back.boundingBox(), await title.boundingBox(), await info.boundingBox()];
      // Back on the left, title in the middle, actions on the right.
      expect(b!.x).toBeLessThan(t!.x);
      expect(t!.x + t!.width).toBeLessThan(i!.x);
      const barBox = (await bar.boundingBox())!;
      expect(Math.abs(t!.x + t!.width / 2 - (barBox.x + barBox.width / 2))).toBeLessThan(40);
      await expect(page.getByTestId("viewer-zoom-slider")).toBeVisible();
      await expect(page.locator(".desktop-viewer__filmstrip, [data-testid=filmstrip]")).toHaveCount(0);

      // Background follows the appearance.
      const bg = await page.locator(".desktop-viewer").evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(scheme === "light" ? "rgb(255, 255, 255)" : "rgb(30, 30, 30)");

      // Zoom controls drive the same zoom as the wheel / double-click.
      const slider = page.getByTestId("viewer-zoom-slider");
      await viewer.getByRole("button", { name: "Zoom In" }).click();
      expect(Number(await slider.inputValue())).toBeGreaterThan(1);
      await viewer.getByRole("button", { name: "Zoom Out" }).click();
      expect(Number(await slider.inputValue())).toBe(1);

      await page.screenshot({ path: `${SHOTS}/desktop-302-viewer-topbar-${scheme}.png` });

      // Keys still work.
      const before = await position(page);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => position(page)).not.toBe(before);
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => position(page)).toBe(before);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);
    });
  });
}
