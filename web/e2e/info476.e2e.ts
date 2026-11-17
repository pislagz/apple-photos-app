import { type Page, expect, test } from "@playwright/test";

// #476: in a row, the (i) must never sit to the right of the row's action control.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_476 ?? "e2e-shots-476";
const SECTIONS = ["Libraries", "People", "Sharing", "Devices", "Activity", "Settings"];

async function open(page: Page, section: string) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, level: 1 })).toBeVisible();
}

// Returns descriptions of (i) buttons whose row/bar has a control to their left.
async function offenders(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const info of document.querySelectorAll<HTMLElement>(".info-button")) {
      const row = info.closest<HTMLElement>(".admin-row, .admin-actions-bar");
      if (!row) continue;
      const x = info.getBoundingClientRect().right;
      for (const c of row.querySelectorAll<HTMLElement>("button:not(.info-button), a.admin-btn, select, input, [role=switch]")) {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.right < x - 1 && r.left < info.getBoundingClientRect().left) bad.push(info.getAttribute("aria-label") ?? "(i)");
      }
    }
    return bad;
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const section of SECTIONS) {
    test(`${section} (i) left of controls, ${scheme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await open(page, section);
      await page.waitForTimeout(500);
      expect(await offenders(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${section.toLowerCase()}-${scheme}.png`, fullPage: true });
    });
  }
}

test("Library detail (i) left of controls", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "Libraries");
  await page.locator(".admin-row[role=listitem] button, button.admin-row").first().click();
  await page.waitForTimeout(500);
  expect(await offenders(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/library-detail-light.png`, fullPage: true });
});
