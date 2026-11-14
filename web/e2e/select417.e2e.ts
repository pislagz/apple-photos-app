import { type Page, expect, test } from "@playwright/test";

// #417: Select / Cancel on every phone grid reached from More is the same
// button as on the main Library All Photos grid.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/417";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone viewport only");
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 20000 });
}

async function measure(page: Page, name: "Select" | "Cancel") {
  const button = page.locator(".mobile-library__top-bar").getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  return button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      font: `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}`,
      color: cs.color,
    };
  });
}

type Box = Awaited<ReturnType<typeof measure>>;
function same(a: Box, b: Box) {
  for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs(a[k] - b[k]), k).toBeLessThanOrEqual(1);
  expect(a.bg).toBe(b.bg);
  expect(a.radius).toBe(b.radius);
  expect(a.font).toBe(b.font);
  expect(a.color).toBe(b.color);
}

for (const scheme of ["light", "dark"] as const) {
  test(`#417 More grids' Select/Cancel match the main grid (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const tabs = page.locator(".tab-bar");

    await tabs.getByRole("button", { name: "Library" }).click();
    await page.getByRole("tab", { name: "All Photos" }).click();
    const mainSelect = await measure(page, "Select");
    await page.screenshot({ path: `${SHOTS}/main-${scheme}.png` });
    await page.locator(".mobile-library__top-bar").getByRole("button", { name: "Select", exact: true }).click();
    const mainCancel = await measure(page, "Cancel");
    same(mainSelect, mainCancel);
    await page.locator(".mobile-library__top-bar").getByRole("button", { name: "Cancel", exact: true }).click();

    const labels = ["Videos", "Selfies", "Screenshots"];
    for (const label of labels) {
      if (label === labels[0]) await tabs.getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: label, exact: true }).first().click();
      const select = await measure(page, "Select");
      same(mainSelect, select);
      await page.screenshot({ path: `${SHOTS}/${label}-${scheme}.png` });
      await page.locator(".mobile-library__top-bar").getByRole("button", { name: "Select", exact: true }).click();
      const cancel = await measure(page, "Cancel");
      same(mainCancel, cancel);
      same(select, cancel);
      await page.locator(".mobile-library__top-bar").getByRole("button", { name: "Cancel", exact: true }).click();
      await page.locator(".mobile-library__back").click();
    }
  });
}
