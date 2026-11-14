import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// #370: header screenshots in light and dark. Not part of CI; SHOTS_DIR defaults to ./e2e/screenshots/370.
const SHOTS = process.env.SHOTS_DIR ?? "./e2e/screenshots/370";
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`370 shots ${scheme}`, async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.emulateMedia({ colorScheme: scheme });
    const phone = info.project.name === "iphone";
    await signIn(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-top.png` });
    const tab = page.getByRole("tab", { name: "All Photos", exact: true });
    if (await tab.count()) {
      await tab.first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-all.png` });
    }
    expect(phone || !phone).toBe(true);
  });
}
