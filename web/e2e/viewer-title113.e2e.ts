import { type Page, expect, test } from "@playwright/test";

// #113: the desktop viewer top bar shows the photo's date/time (and place) as a
// read-only title, updating as you page, truncating at narrow widths.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/p113";

async function open(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`#113 ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("title shows date, follows paging, is read-only, truncates", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "desktop viewer only");
      await open(page);
      const title = page.getByTestId("viewer-title");
      await expect(title).toContainText(/\d{4}/);
      await expect(page.getByTestId("desktop-viewer").getByRole("button", { name: /favou?rite/i })).toHaveCount(0);

      // No place: the date and time lead, position below.
      const plain = (await title.textContent()) ?? "";
      expect(plain).toMatch(/\d{4} at \d{2}:\d{2}:\d{2}/);
      await page.screenshot({ path: `${SHOTS}/viewer-${scheme}-noplace-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 60 } });
      await page.setViewportSize({ width: 900, height: 700 });
      await page.screenshot({ path: `${SHOTS}/viewer-${scheme}-noplace-900.png`, clip: { x: 0, y: 0, width: 900, height: 60 } });
      await page.setViewportSize({ width: 1440, height: 900 });

      // Paging updates the title.
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await title.textContent()) ?? "").not.toBe(plain);

      // With a place (injected into the detail response; no network): place leads.
      await page.route(/\/api\/libraries\/\d+\/assets\/[^/]+$/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, place: "Reykjavik Harbour With A Rather Long Name", place_offline: null } });
      });
      await page.keyboard.press("ArrowRight");
      await expect(title.locator(".desktop-viewer__title-primary")).toContainText("Reykjavik");
      await expect(title.locator(".desktop-viewer__title-secondary")).toContainText(/ at \d{2}:\d{2}:\d{2} · \d+ of /);
      await page.screenshot({ path: `${SHOTS}/viewer-${scheme}-place-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 60 } });

      await page.setViewportSize({ width: 900, height: 700 });
      await page.screenshot({ path: `${SHOTS}/viewer-${scheme}-place-900.png`, clip: { x: 0, y: 0, width: 900, height: 60 } });
      await expect(title).toBeVisible();
      const box = (await title.boundingBox())!;
      const info = (await page.getByTestId("desktop-viewer").getByRole("button", { name: "Info" }).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(info.x + 1);
      const overflow = await title.locator(".desktop-viewer__title-primary").evaluate((el) => getComputedStyle(el).textOverflow);
      expect(overflow).toBe("ellipsis");
    });
  });
}
