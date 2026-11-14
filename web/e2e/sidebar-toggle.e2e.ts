import { type Page, expect, test } from "@playwright/test";

// #349: the sidebar toggle must always bring the sidebar back, also after a
// reload; #350: the shared download icon in the desktop toolbar and viewer.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/p349";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`sidebar toggle hides, re-shows and survives a reload (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const side = page.locator("aside.sidebar");
    await expect(side).toBeVisible();
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/sidebar-hidden-${scheme}.png` });

    // A real click at the toggle's position must reach the button, not the toolbar.
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(side).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/sidebar-shown-${scheme}.png` });

    // Hidden state persists, and the toggle still works after a reload.
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await page.reload();
    await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(1);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(page.locator(".shell--sidebar-collapsed")).toHaveCount(0);
    await expect(side).toBeVisible();
  });

  test(`download icon in toolbar and viewer (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const cell = page.locator("[data-asset-id], .photo-cell, .desktop-library__grid button").first();
    await cell.click();
    await page.screenshot({ path: `${SHOTS}/download-toolbar-${scheme}.png` });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/download-viewer-${scheme}.png` });
  });
}

test("iPhone viewer download-original icon screenshots", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "iPhone layout only");
  await signIn(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("button[aria-label^='Photo'], .mobile-library__grid button, [data-asset-id]").first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/download-iphone-viewer-${scheme}.png` });
    await page.goto("/");
  }
});
