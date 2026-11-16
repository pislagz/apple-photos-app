import { expect, test, type Page } from "@playwright/test";

// #485: the phone viewer's top-right ••• button opens its menu.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-485";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`viewer ••• button opens its menu (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator("img.mobile-library__cell").nth(0).click();
    const more = page.getByTestId("mobile-viewer").getByRole("button", { name: "More" });
    await expect(more).toBeVisible();
    await page.waitForTimeout(600);
    await more.tap();
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${scheme}-viewer-more-menu.png` });
    await page.getByRole("menuitem", { name: "Info" }).tap();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("viewer-info-sheet")).toBeVisible();
  });
}
