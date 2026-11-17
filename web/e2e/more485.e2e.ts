import { expect, test, type Page } from "@playwright/test";

// #485: the phone viewer's top-right ••• button opens its menu.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-g490";

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
    await expect(menu.getByRole("menuitem")).toHaveCount(1);
    await expect(menu).not.toContainText(/share|download/i);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${scheme}-viewer-more-menu.png` });
    await page.getByRole("menuitem", { name: "Info" }).tap();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("viewer-info-sheet")).toBeVisible();
  });
}

// #503: clicking or tapping outside closes the menu and does nothing else.
for (const how of ["mouse", "touch"] as const) {
  test(`viewer ••• menu closes on an outside ${how} press (#503)`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone breakpoint only");
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator("img.mobile-library__cell").nth(0).click();
    const viewer = page.getByTestId("mobile-viewer");
    await page.waitForTimeout(600);
    const more = viewer.getByRole("button", { name: "More" });
    const menu = page.getByRole("menu", { name: "More" });
    const chromeBefore = await viewer.getAttribute("class");
    const spots = how === "mouse" ? ([["stage", 195, 450], ["topbar", 100, 30]] as const) : ([["stage", 195, 450]] as const);
    for (const [name, x, y] of spots) {
      await more.tap();
      await expect(menu).toBeVisible();
      if (how === "mouse") await page.mouse.click(x, y);
      else await page.touchscreen.tap(x, y);
      await expect(menu).toHaveCount(0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e-shots-503/${how}-${name}-closed.png` });
      expect(await viewer.getAttribute("class")).toBe(chromeBefore);
    }
  });
}
