import { expect, test } from "@playwright/test";

const USER = { username: "demo-user", password: "demo-user-pass-1" };

// #474: hovering a cut-off sidebar name shows exactly one tooltip: ours.
for (const scheme of ["light", "dark"] as const) {
  test(`a truncated sidebar name shows one tooltip, ${scheme} (#474)`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("[data-asset-id]").first()).toBeVisible();
    const sidebar = page.locator("#app-sidebar");
    // No native tooltip source anywhere in the sidebar.
    expect(await sidebar.locator("[title], svg title, [aria-describedby]").count()).toBe(0);
    const labels = sidebar.locator(".sidebar__label");
    await expect(labels.first()).toBeVisible();
    // Narrow the sidebar so a name is cut off whatever the demo data holds.
    await page.locator(".shell").evaluate((el) => (el as HTMLElement).style.setProperty("--sidebar-width", "170px"));
    const all = await labels.evaluateAll((els) => els.map((el) => el.scrollWidth > el.clientWidth));
    const target = all.indexOf(true);
    expect(target).toBeGreaterThanOrEqual(0);
    await labels.nth(target).hover();
    await expect(page.locator(".sidebar-tooltip")).toHaveCount(1);
    await page.waitForTimeout(1500);
    await expect(page.locator(".sidebar-tooltip")).toHaveCount(1);
    expect(await page.locator("[title]:hover, .sidebar-tooltip").count()).toBe(1);
    await page.screenshot({ path: `e2e-shots-474/hover-${scheme}.png`, clip: { x: 0, y: 0, width: 520, height: 900 } });
  });
}
