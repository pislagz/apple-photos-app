import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// #484: a filter that matches nothing says so and offers Clear Filter, instead
// of claiming the library has no photos.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "./e2e-shots-484";

async function signIn(page: Page) {
  await page.route(/\/api\/libraries\/\d+\/(assets|summary)\?.*favorite=true/, (route) =>
    route.fulfill({
      json: route.request().url().includes("/summary") ? { years: [], months: [], days: [] } : { items: [], next_cursor: null },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("empty filter shows a filter message and clears", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iphone only");
  mkdirSync(SHOTS, { recursive: true });
  await signIn(page);
  const desktop = info.project.name === "desktop";
  if (desktop) {
    await page.getByRole("button", { name: "Filter By" }).click();
    await page.getByRole("menuitemradio", { name: /Favorites/ }).click();
  } else {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Filter/ }).click();
    await page.getByRole("menuitemradio", { name: /Favorites/ }).click();
  }
  const empty = page.getByTestId("library-empty");
  await expect(empty).toContainText("No Favorites");
  await expect(empty).toContainText("No items match this filter.");
  await expect(empty).not.toContainText("added to this library");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-filter-empty.png` });
  await empty.getByRole("button", { name: "Clear Filter" }).click();
  await expect(page.getByTestId("library-empty")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-filter-cleared.png` });
});
