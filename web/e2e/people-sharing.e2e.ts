import { type Page, expect, test } from "@playwright/test";

// #314: People and Sharing. Screenshots: web/e2e/screenshots/314-<project>-<scheme>-*.png
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

async function open(page: Page, section: "People" | "Sharing") {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, level: 1 })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`people (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${SHOTS}/314-${info.project.name}-${scheme}`;
    await open(page, "People");
    await expect(page.getByRole("button", { name: /demo-admin.*You/ })).toBeVisible();
    await page.screenshot({ path: `${tag}-people.png`, fullPage: true });

    // Detail of yourself: sign-in switch and delete are blocked with a reason.
    await page.getByRole("button", { name: /demo-admin/ }).click();
    await expect(page.getByRole("switch", { name: "demo-admin is allowed to sign in" })).toBeDisabled();
    await expect(page.getByText(/can't delete your own account/)).toBeVisible();
    await page.screenshot({ path: `${tag}-self.png`, fullPage: true });
    if (isMobile) {
      const row = page.locator(".admin-people .admin-row").first();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Detail of the other person: delete sheet names them, Cancel keeps them.
    await page.getByRole("button", { name: "‹ People" }).click();
    const others = page.locator(".admin-group__rows button.admin-row--action").filter({ hasNotText: /You|…/ });
    await others.first().click();
    await page.getByRole("button", { name: /^Delete User/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Photos and libraries are not affected");
    await page.screenshot({ path: `${tag}-delete.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Change password sheet validates the repeat field.
    await page.getByRole("button", { name: /^Change Password/ }).click();
    await dialog.getByLabel("New password").fill("a-long-password-1");
    await dialog.getByLabel("Type it again").fill("different-pass-2");
    await expect(dialog.getByRole("alert")).toContainText("not the same");
    await page.screenshot({ path: `${tag}-password.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Invitation sheet.
    await page.getByRole("button", { name: "‹ People" }).click();
    await page.getByRole("button", { name: /Invite Someone/ }).click();
    await dialog.getByRole("button", { name: "Create Link" }).click();
    await expect(dialog.getByLabel("Invitation link")).toBeVisible();
    await page.screenshot({ path: `${tag}-invite.png` });
    await dialog.getByRole("button", { name: "Done" }).click();
    await page.screenshot({ path: `${tag}-people-after-invite.png`, fullPage: true });
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    expect(errors).toEqual([]);
  });

  test(`sharing (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const tag = `${SHOTS}/314-${info.project.name}-${scheme}`;
    await open(page, "Sharing");
    const switches = page.getByRole("switch", { name: / can see / });
    await expect(switches.first()).toBeVisible();
    expect(await page.getByRole("table").count()).toBe(isMobile ? 0 : 1);
    await page.screenshot({ path: `${tag}-sharing.png`, fullPage: true });

    // Turning off asks first, naming person and library; Cancel changes nothing.
    const on = page.getByRole("switch", { name: / can see /, checked: true }).first();
    const name = (await on.getAttribute("aria-label"))!;
    await on.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("will no longer see");
    await page.screenshot({ path: `${tag}-sharing-confirm.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("switch", { name })).toBeChecked();
  });
}
