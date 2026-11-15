import { expect, test } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

for (const scheme of ["light", "dark"] as const) {
  test(`iPhone Library opens on All Photos, ${scheme} (#304)`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-asset-id]").first()).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/iphone-all-photos-${info.project.name}-${scheme}.png` });

    for (const name of ["Years", "Months", "Days"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    }
  });
}
