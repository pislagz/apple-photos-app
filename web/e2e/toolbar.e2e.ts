import { type Page, expect, test } from "@playwright/test";

// #296: one fixed toolbar row on every desktop view; the search field has the
// same box in Library, Favorites and Map, at 1440px and 1024px.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function views(page: Page) {
  const side = page.locator("aside.sidebar");
  return [
    ["Library", async () => side.getByRole("button", { name: "Library", exact: true }).click()],
    ["Favorites", async () => side.getByRole("button", { name: "Favorites", exact: true }).click()],
    ["Map", async () => side.getByRole("button", { name: "Map", exact: true }).click()],
  ] as const;
}

for (const width of [1440, 1024]) {
  test(`search field has the same box in Library, Favorites and Map at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    const boxes: { x: number; width: number; height: number; y: number }[] = [];
    for (const [name, open] of await views(page)) {
      await open();
      await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
      const toolbar = page.getByTestId("shell-toolbar");
      // The title is below the toolbar row, never inside it.
      await expect(toolbar.getByRole("heading")).toHaveCount(0);
      const tb = (await toolbar.boundingBox())!;
      const title = (await page.getByRole("heading", { name, exact: true, level: 1 }).boundingBox())!;
      expect(title.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
      boxes.push((await page.locator(".shell__search .search-box").boundingBox())!);
    }
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(boxes[0].x, 1);
      expect(box.width).toBeCloseTo(boxes[0].width, 1);
      expect(box.y).toBeCloseTo(boxes[0].y, 1);
    }
    // Collapsed to the magnifier at <=1100px, the full field above.
    expect(boxes[0].width).toBeCloseTo(width <= 1100 ? 28 : 140, 0);
  });
}

test("narrow window: field expands on focus without overlapping the controls", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page);
  const field = page.getByRole("searchbox", { name: "Search photos" });
  await field.focus();
  await expect.poll(async () => (await field.boundingBox())!.width).toBeGreaterThan(150);
  const last = (await page.getByTestId("shell-toolbar").getByRole("button", { name: "Info" }).boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual((await field.boundingBox())!.x + 1);
});
