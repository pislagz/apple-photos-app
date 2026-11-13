import { type Page, expect, test } from "@playwright/test";

// #268: the (i) buttons on the admin Settings screen. Desktop shows the text on
// hover and on keyboard focus; the iPhone project taps. Light and dark shots.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

async function openSettings(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`info text opens (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openSettings(page);
    const button = page.getByRole("button", { name: "About zip size limit" });
    await button.scrollIntoViewIfNeeded();
    const tip = page.getByRole("tooltip").filter({ hasText: "biggest download" });
    await expect(tip).toBeHidden();
    if (isMobile) await button.tap();
    else await button.hover();
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-info-${scheme}.png` });
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });
}

test("keyboard focus opens and Escape closes", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard path is desktop");
  await openSettings(page);
  const button = page.getByRole("button", { name: "About thumbnail quality" });
  await button.focus();
  await expect(page.getByRole("tooltip").filter({ hasText: "How much detail" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip").filter({ hasText: "How much detail" })).toBeHidden();
});
