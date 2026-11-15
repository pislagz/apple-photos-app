import { type Page, expect, test } from "@playwright/test";

// #263 F5: the empty-state block is centred vertically in the visible content
// area below the toolbar/title, not only horizontally.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.route(/\/api\/libraries\/\d+\/(assets|summary)(\?.*)?$/, (route) => {
    const url = route.request().url();
    const body = url.includes("/summary") ? { years: [], months: [], days: [] } : { items: [], next_cursor: null };
    return route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("empty state is centred vertically in the content area", async ({ page }) => {
  await signIn(page);
  const empty = page.getByTestId("library-empty");
  await expect(empty).toBeVisible();
  const m = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="library-empty"]') as HTMLElement;
    const area = el.parentElement as HTMLElement;
    const a = area.getBoundingClientRect();
    const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
    return {
      areaTop: a.top,
      areaBottom: a.bottom,
      top: Math.min(...kids.map((k) => k.top)),
      bottom: Math.max(...kids.map((k) => k.bottom)),
    };
  });
  const above = m.top - m.areaTop;
  const below = m.areaBottom - m.bottom;
  // Mobile keeps 72px under the scroll content for the floating pill, so allow that.
  expect(Math.abs(above - below)).toBeLessThanOrEqual(80);
  expect(above).toBeGreaterThan(40);
  expect(below).toBeGreaterThan(40);
});
