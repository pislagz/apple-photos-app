import { expect, test, type Page } from "@playwright/test";

// #260: every phone photo grid shares one top bar, so Select sits at the
// same spot in the Library and in a pushed More grid.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function selectBox(page: Page) {
  const select = page.getByRole("button", { name: "Select", exact: true });
  await expect(select).toBeVisible();
  return (await select.boundingBox())!;
}

test("Select sits at the same spot in the Library and in More grids", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  const library = await selectBox(page);

  for (const name of ["Videos", "Screenshots"]) {
    await page.goto("/more");
    await page.getByRole("button", { name, exact: false }).first().click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    // One header: the back button, Select and the title, no second bar.
    await expect(page.locator('[data-testid="top-bar"]')).toHaveCount(1);
    const pushed = await selectBox(page);
    expect(Math.abs(pushed.y - library.y), name).toBeLessThanOrEqual(1);
    expect(Math.abs(pushed.x + pushed.width - (library.x + library.width)), name).toBeLessThanOrEqual(1);
  }
});
