import { type Page, expect, test } from "@playwright/test";

// #292 / F9: macOS-style account menu on the desktop sidebar. Desktop only.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "sidebar account row is desktop only");
});

test("footer row is inset and vertically centred, hover highlight is padded", async ({ page }) => {
  await signIn(page);
  const row = page.getByRole("button", { name: "Account menu" });
  const pad = await row.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { l: parseFloat(cs.paddingLeft), t: parseFloat(cs.paddingTop) };
  });
  expect(pad.l).toBeGreaterThan(0);
  expect(pad.t).toBeGreaterThan(0);
  const item = page.locator("aside.sidebar .sidebar__item").first();
  const [rb, ib] = [await row.boundingBox(), await item.boundingBox()];
  expect(Math.abs(rb!.x - ib!.x)).toBeLessThanOrEqual(1);
  const avatar = await page.locator(".account-menu__avatar").boundingBox();
  expect(Math.abs(avatar!.y + avatar!.height / 2 - (rb!.y + rb!.height / 2))).toBeLessThanOrEqual(1);
  await row.hover();
  const hl = await row.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseFloat(hl)).toBeGreaterThan(0);
});

test("hovering a parent opens its submenu and it stays open under the pointer", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Library" }).hover();
  const sub = page.getByRole("menu", { name: "Library" });
  await expect(sub).toBeVisible();
  await sub.getByRole("menuitemradio", { name: "Demo Library" }).hover();
  await page.waitForTimeout(600);
  await expect(sub).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Demo Library" })).toHaveAttribute("aria-checked", /true|false/);
});

test("a diagonal move from the parent into the submenu keeps it open", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  const layout = (await page.getByRole("menuitem", { name: "Library" }).boundingBox())!;
  await page.mouse.move(layout.x + 20, layout.y + layout.height / 2);
  const sub = page.getByRole("menu", { name: "Library" });
  await expect(sub).toBeVisible();
  const sb = (await sub.boundingBox())!;
  // Slide diagonally from the parent row into the submenu's row (the submenu is a
  // single row here, so the old "across a sibling item" path would leave the safe zone).
  await page.mouse.move(layout.x + layout.width - 30, layout.y + layout.height / 2 + 4, { steps: 4 });
  await page.mouse.move(sb.x + 6, sb.y + sb.height - 4, { steps: 3 });
  await page.waitForTimeout(500);
  await expect(sub).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Demo Library" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("pointing at a plain item closes the open submenu; arrows still work", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Library" }).hover();
  await expect(page.getByRole("menu", { name: "Library" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Log Out" }).hover();
  await expect(page.getByRole("menu", { name: "Library" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Library" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio", { name: "Demo Library" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("menuitem", { name: "Library" })).toBeFocused();
});
