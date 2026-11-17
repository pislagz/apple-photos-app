import { type Page, expect, test } from "@playwright/test";

// #486: the link icon needs both hooks and the middle bar.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e-shots-486";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 3 });

    test("desktop viewer link icon", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await signIn(page);
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
      const viewer = page.getByTestId("desktop-viewer");
      await expect(viewer).toBeVisible();
      const link = viewer.getByRole("button", { name: "Copy Link", exact: true });
      await expect(link.locator("svg path")).toHaveCount(3);
      await link.screenshot({ path: `${OUT}/desktop-${scheme}-link-icon.png` });
      await page.locator(".desktop-viewer__topbar-right").screenshot({ path: `${OUT}/desktop-${scheme}-toolbar.png` });
    });
  });
}
