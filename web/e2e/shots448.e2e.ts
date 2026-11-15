import { expect, test } from "@playwright/test";

// #445: big titles stay bold; only the toolbar title is regular weight.
// Screenshots go to test-results/shots448/ (not committed).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "test-results/shots448";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

const weight = (page: import("@playwright/test").Page, sel: string) =>
  page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontWeight);

for (const scheme of ["light", "dark"] as const) {
  test(`desktop: big grid title bold, viewer toolbar title regular (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
    expect(await weight(page, ".desktop-library__title")).toBe("700");
    await page.screenshot({ path: `${SHOTS}/desktop-grid-${scheme}.png` });
    await page.locator('[data-testid="library-cell"]').nth(2).dblclick();
    await expect(page.getByTestId("desktop-viewer")).toBeVisible();
    expect(await weight(page, ".desktop-viewer__title-primary")).toBe("400");
    await page.screenshot({ path: `${SHOTS}/desktop-viewer-${scheme}.png` });
  });
}

test("iPhone: Days large title stays bold", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "phone only");
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await page.getByRole("tab", { name: "Days", exact: true }).click();
  await expect(page.locator(".period-card--days").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const big = await page.locator('[data-testid="period-grid-header"] h1, [data-testid="period-grid-header"] h2').first();
  expect(Number(await big.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(700);
  await page.screenshot({ path: `${SHOTS}/iphone-days-light.png` });
});
