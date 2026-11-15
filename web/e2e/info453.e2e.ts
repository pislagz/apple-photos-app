import { type Page, expect, test } from "@playwright/test";

// #453: (i) buttons on Sharing, Devices and Activity. Desktop, light.
// Screenshots go to SHOTS_453 (default /home/rakazo/rakazo-home/shared/shots453).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_453 ?? "/home/rakazo/rakazo-home/shared/shots453";

const CASES: Array<{ section: "Sharing" | "Devices" | "Activity"; buttons: string[] }> = [
  { section: "Sharing", buttons: ["sharing", "administrators"] },
  { section: "Devices", buttons: ["devices", "signing a device out"] },
  { section: "Activity", buttons: ["activity", "filters", "export"] },
];

async function open(page: Page, section: string) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, level: 1 })).toBeVisible();
}

for (const { section, buttons } of CASES) {
  test(`${section} (i) popovers, desktop light`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await open(page, section);
    for (const name of buttons) {
      const button = page.getByRole("button", { name: `About ${name}` }).first();
      await expect(button).toBeVisible();
      await button.click();
      const tip = page.locator(`[id="${await button.getAttribute("aria-describedby")}"]`);
      await expect(tip).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/453-${section.toLowerCase()}-${name.replace(/ /g, "-")}.png` });
      await page.mouse.click(5, 5);
      await expect(tip).toBeHidden();
    }
  });
}
