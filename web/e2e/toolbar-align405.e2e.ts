import { type Page, expect, test } from "@playwright/test";

// #405: the Filter By pill and the search box share one right edge.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e/screenshots/n1114c";

async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const library = page.locator("aside.sidebar").getByRole("button", { name: "Library" });
  if (await library.isVisible()) await library.click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 900]) {
    test(`pill and search right edges align, ${scheme} ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await openLibrary(page);
      const pill = (await page.getByRole("button", { name: "Filter By" }).boundingBox())!;
      const search = (await page.locator(".search-box--desktop").boundingBox())!;
      expect(Math.abs(pill.x + pill.width - (search.x + search.width)), `pill ${pill.x + pill.width} search ${search.x + search.width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${OUT}/405-toolbar-${scheme}-${width}.png`, clip: { x: 0, y: 0, width, height: 120 } });
    });
  }
}
