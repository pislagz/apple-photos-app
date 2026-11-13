import { type Page, expect, test } from "@playwright/test";

// #212 iPhone Library header over white, black and mid-tone photos, in light
// and dark, plus selection mode. Thumbnails are replaced by flat SVG colours so
// the worst-case backgrounds are exact. Needs the demo server (scripts/dev_demo.py).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";
const TONES = { white: "#ffffff", black: "#000000", mid: "#808080" } as const;

async function signIn(page: Page, tone: string) {
  await page.route("**/api/libraries/*/thumb/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${tone}"/></svg>`,
    }),
  );
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone header only; desktop is unchanged");
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, tone] of Object.entries(TONES)) {
    test(`header over ${name} photos, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, tone);
      await expect(page.getByTestId("header-title")).toHaveText("Library");
      await expect(page.getByTestId("header-subtitle")).not.toBeEmpty();
      for (const control of [page.getByRole("button", { name: "Select" }), page.getByRole("button", { name: "Account menu" })]) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${SHOTS}/212-header-${name}-${scheme}.png`, clip: { x: 0, y: 0, width: 390, height: 260 } });
    });
  }

  test(`selection mode, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page, TONES.mid);
    await page.getByRole("button", { name: "Select" }).click();
    await expect(page.getByTestId("header-title")).toHaveText("Select Items");
    await page.locator(".mobile-library__cell").nth(0).click();
    await page.locator(".mobile-library__cell").nth(1).click();
    await expect(page.getByTestId("header-subtitle")).toHaveText("2 Selected");
    const close = await page.getByRole("button", { name: "Cancel" }).boundingBox();
    const title = await page.getByTestId("header-title").boundingBox();
    expect(close!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
    expect(close!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SHOTS}/212-header-selection-${scheme}.png` });
  });
}
