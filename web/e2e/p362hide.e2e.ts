import { type Page, expect, test } from "@playwright/test";

// #362: the sidebar lists only media types that have items.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/p362hide";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`sidebar hides empty media types (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const side = page.locator("aside.sidebar");
    await expect(side).toBeVisible();
    await expect(side.getByText("Media types")).toBeVisible();
    // No row is ever disabled: empty types are absent, not greyed out.
    await expect(side.locator(".sidebar__item:disabled", { hasText: /Selfies|Live Photos|Portrait|RAW/ })).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/sidebar-${scheme}.png` });
  });
}
