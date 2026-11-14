import { expect, test, type Page } from "@playwright/test";

// #390 #391 #393 #395: geometry checks from pp's 2026-11-14 round.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("#390 mobile login: focus ring wraps the whole field row", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await page.goto("/");
  const input = page.getByLabel("Username");
  await input.focus();
  const row = page.locator(".login-card form > label").first();
  const style = await row.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow };
  });
  expect(style.outline).toBe("solid");
  expect(style.width).toBeGreaterThanOrEqual(2);
  const inner = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineColor, shadow: s.boxShadow };
  });
  expect(inner.outline).toBe("rgba(0, 0, 0, 0)");
  expect(inner.shadow).toBe("none");
});

test("#390 desktop login keeps a visible keyboard focus ring", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.keyboard.press("Shift");
  await page.getByLabel("Username").focus();
  await expect(page.getByLabel("Username")).toBeFocused();
  const shadow = await page.getByLabel("Username").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
});

test("#391 Cancel keeps Select's exact position and size", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  const select = page.getByRole("button", { name: "Select", exact: true });
  await expect(select).toBeVisible();
  const before = (await select.boundingBox())!;
  await select.click();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  const after = (await cancel.boundingBox())!;
  for (const k of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(after[k] - before[k]), k).toBeLessThanOrEqual(0.5);
  }
});

test("#393 Filter By pill matches the search box height and padding", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  const pill = page.getByRole("button", { name: "Filter By" });
  const search = page.getByRole("search").first();
  await expect(pill).toBeVisible();
  await expect(search).toBeVisible();
  const p = (await pill.boundingBox())!;
  const s = (await search.boundingBox())!;
  expect(p.height).toBe(s.height);
  expect(p.width).toBeGreaterThanOrEqual(s.width);
  const pad = (loc: typeof pill) => loc.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(await pad(pill)).toBe(await pad(search));
});

test("#395 viewer top bar icon hover target is square", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  const buttons = page.locator(".desktop-viewer__topbar .toolbar-button");
  const n = await buttons.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const b = (await buttons.nth(i).boundingBox())!;
    expect(b.width, `button ${i}`).toBe(b.height);
  }
});
