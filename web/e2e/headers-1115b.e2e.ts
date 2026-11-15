import { expect, test } from "@playwright/test";

// #1115b: phone headers, light and dark, Library and a pushed More grid.
// Screenshots go to e2e/screenshots/e1115b/.
const SHOTS = "e2e/screenshots/e1115b";

for (const scheme of ["light", "dark"] as const) {
  test(`Library and More grid headers, ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "phone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill("demo-user");
    await page.getByLabel("Password").fill("demo-user-pass-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="top-bar"]:visible')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/library-${scheme}.png`, clip: { x: 0, y: 0, width: 390, height: 260 } });

    await page.goto("/more");
    await page.getByRole("button", { name: "Videos" }).first().click();
    await expect(page.getByRole("heading", { name: "Videos", exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="top-bar"]:visible')).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOTS}/more-videos-${scheme}.png`, clip: { x: 0, y: 0, width: 390, height: 260 } });
  });
}
