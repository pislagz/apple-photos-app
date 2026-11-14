import { type Page, expect, test } from "@playwright/test";

// #303: the iPhone top-right "..." menu is gone; its actions live in More.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

for (const scheme of ["light", "dark"] as const) {
  test(`More tab holds the account actions, no top-right menu (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const menu = page.getByRole("button", { name: "Account menu" });
    const tabs = page.getByRole("navigation", { name: "Primary" });

    await expect(menu).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-303-library-${scheme}.png` });
    await tabs.getByRole("button", { name: "Albums" }).click();
    await expect(menu).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-303-albums-${scheme}.png` });
    await tabs.getByRole("button", { name: "More" }).click();
    await expect(menu).toHaveCount(0);

    for (const name of ["Change password", "Passkeys", "Log out"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByLabel("Layout")).toHaveCount(0);
    await expect(page.getByText(`Signed in as ${USER.username}`)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-303-more-${scheme}.png` });

    await page.getByRole("button", { name: "Passkeys", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Passkeys" })).toBeVisible();
  });
}
