import { type Page, expect, test } from "@playwright/test";

// #315: Devices and Activity. Screenshots: web/e2e/screenshots/315-<project>-<scheme>-*.png
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

async function open(page: Page, section: "Devices" | "Activity") {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, level: 1 })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`devices (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => {
      errors.push(`native dialog: ${d.message()}`);
      void d.dismiss();
    });
    const tag = `${SHOTS}/315-${info.project.name}-${scheme}`;
    await open(page, "Devices");
    await expect(page.getByText("This device", { exact: true })).toBeVisible();
    await expect(page.getByText(/can't be signed out here/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/\d{4}-\d{2}-\d{2}T/);
    await page.screenshot({ path: `${tag}-devices.png`, fullPage: true });
    if (isMobile) {
      const btn = page.getByRole("button", { name: /^Sign out/ }).first();
      if (await btn.count()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const signOut = page.getByRole("button", { name: /^Sign out/ });
    if (await signOut.count()) {
      await signOut.first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("can sign in again");
      await page.screenshot({ path: `${tag}-devices-confirm.png` });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    }
    expect(errors).toEqual([]);
  });

  test(`activity (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${SHOTS}/315-${info.project.name}-${scheme}`;
    await open(page, "Activity");
    await expect(page.locator(".admin-activity .admin-row__value time").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/\b(add_library|create_user|revoke_session)\b/);
    await page.screenshot({ path: `${tag}-activity.png`, fullPage: true });
    if (isMobile) {
      const sel = page.getByRole("combobox", { name: "Person" });
      expect((await sel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Filter by a person's name, then clear.
    const person = page.getByRole("combobox", { name: "Person" });
    await expect(person.locator("option")).not.toHaveCount(1);
    await person.selectOption({ index: 1 });
    await page.screenshot({ path: `${tag}-activity-filtered.png`, fullPage: true });
    await page.getByRole("combobox", { name: "Library" }).selectOption({ index: 1 });
    await expect(page.getByRole("link", { name: "Export as CSV" })).toHaveAttribute("href", /user_id=\d+.*library_id=\d+|library_id=\d+.*user_id=\d+/);
    expect(errors).toEqual([]);
  });
}
