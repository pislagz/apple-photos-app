import { type Page, expect, test } from "@playwright/test";

const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

// Thumbnails with a src that have not finished loading are the in-flight
// requests (an aborted request loses its src, so it stops counting).
const pendingThumbs = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("img.fade-image")].filter((i) => i.getAttribute("src") && !(i as HTMLImageElement).complete).length);

// #215: tiles fade placeholder -> image, and a scroll never has more than 8
// thumbnail requests in flight.
test("thumbnails fade in and in-flight requests stay at or under 8", async ({ page }) => {
  await signIn(page);
  let peak = 0;
  const tiles = page.locator("img.fade-image");
  await expect(tiles.first()).toBeVisible();
  await expect.poll(() => page.locator('img.fade-image[data-loaded="true"]').count(), { timeout: 15000 }).toBeGreaterThan(0);
  const transition = await tiles.first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toBe("0.15s");

  for (let i = 0; i < 6; i++) {
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 1500);
    peak = Math.max(peak, await pendingThumbs(page));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(800);
  expect(peak).toBeLessThanOrEqual(8);
});
