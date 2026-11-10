import { type Page, expect, test } from "@playwright/test";

// P2.4: Search on both layouts, against the demo server (scripts/dev_demo.py),
// whose photos carry labels such as "Dog" and "Beach".
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("search by label shows results in the grid and opens the viewer", async ({ page }, info) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await signIn(page);

  const mobile = info.project.name !== "desktop";
  if (mobile) {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search$/);
  }
  const field = page.getByRole("searchbox", { name: "Search photos" });
  await field.fill("dog");
  // Wait for the settled query: the route (phone) or the results heading (desktop).
  if (mobile) await expect(page).toHaveURL(/\/search\/dog$/);
  else await expect(page.getByRole("heading", { name: /Results for .dog./ })).toBeVisible();
  await expect(page.locator('img[alt^="IMG_"], img[alt^="MOV_"]').first()).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-search-results.png` });

  // Case-insensitive, and a second term narrows (AND).
  await field.fill("DOG beach");
  await expect(page.locator('img[alt^="IMG_"], img[alt^="MOV_"]').first()).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const lib = me.libraries[0].id;
  const total = async (q: string) =>
    (await (await page.request.get(`/api/libraries/${lib}/search`, { params: { q, limit: "500" } })).json()).items.length;
  const dogs = await total("dog");
  expect(dogs).toBeGreaterThan(0);
  expect(await total("DOG")).toBe(dogs);
  expect(await total("dog beach")).toBeGreaterThan(0);
  expect(await total("dog beach")).toBeLessThan(dogs);
  expect(await total("")).toBe(0);
  await field.fill("sports field");
  if (!mobile) await expect(page.getByRole("heading", { name: /Results for .sports field./ })).toBeVisible();
  await expect(page.locator('img[alt^="IMG_"], img[alt^="MOV_"]').first()).toBeVisible();

  // Nothing matches.
  await field.fill("zzzz");
  await expect(page.getByText(/No results for .zzzz./)).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-search-empty.png` });

  if (mobile) {
    // Deep link: reload keeps the search.
    await field.fill("dog");
    await expect(page).toHaveURL(/\/search\/dog$/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Search photos" })).toHaveValue("dog");
    await expect(page.locator('img[alt^="IMG_"], img[alt^="MOV_"]').first()).toBeVisible();
  } else {
    await field.fill("dog");
    await page.locator('[data-testid="library-cell"]').first().dblclick();
    await expect(page.getByRole("button", { name: /close|back/i }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    // Clearing the field goes back to the whole library.
    await field.fill("");
    await expect(page.getByRole("heading", { name: /Results for/ })).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});
