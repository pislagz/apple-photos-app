import { expect, test, type Page } from "@playwright/test";

// #514: the viewer ••• menu actions (phone layout; desktop has no such menu).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-n514";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`••• menu lists the new actions (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator("img.mobile-library__cell").nth(0).click();
    await page.waitForTimeout(600);
    await page.getByTestId("mobile-viewer").getByRole("button", { name: "More" }).tap();
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu).toBeVisible();
    for (const name of ["Info", "Copy Link", "Download"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
    // Opened from All Photos: no jump row. The app has no slideshow yet.
    await expect(menu.getByRole("menuitem", { name: "Show in All Photos" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Slideshow" })).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${scheme}-viewer-more-menu.png` });
  });
}

test("Show in All Photos from an album jumps to the Library and flashes the tile", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.locator(".tab-bar button", { hasText: "Albums" }).click();
  await page.locator(".albums-home button:has(.album-cover)").first().click();
  await page.locator("img.mobile-library__cell").first().click();
  await page.waitForTimeout(600);
  await page.getByTestId("mobile-viewer").getByRole("button", { name: "More" }).tap();
  await page.getByRole("menuitem", { name: "Show in All Photos" }).tap();
  await expect(page.locator(".tab-bar button[aria-current], .tab-bar button.is-active").first()).toBeVisible();
  await expect(page.locator('[data-located="true"]')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/show-in-all-photos.png` });
});
