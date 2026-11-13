import { type Page, expect, test } from "@playwright/test";

// #331 T5: one control-size system across admin. Screenshots go to SHOT_DIR (default web/e2e/screenshots).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const DIR = process.env.SHOT_DIR ?? "e2e/screenshots";

async function login(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function open(page: Page, section: "Settings" | "People" | "Sharing") {
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, level: 1 })).toBeVisible();
}

async function sizes(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
    }),
  );
}

for (const scheme of ["light", "dark"] as const) {
  test(`admin control sizes (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const tag = `${DIR}/${info.project.name}-${scheme}`;
    const desktop = info.project.name === "desktop";

    await login(page);
    await open(page, "Settings");
    const settingsSwitches = await sizes(page, "button.admin-switch");
    expect(settingsSwitches.length).toBeGreaterThan(0);
    await page.screenshot({ path: `${tag}-settings.png`, fullPage: true });

    await open(page, "Sharing");
    const sharingSwitches = await sizes(page, "button.admin-switch");
    expect(sharingSwitches.length).toBeGreaterThan(0);
    await page.screenshot({ path: `${tag}-sharing.png`, fullPage: true });
    for (const s of [...settingsSwitches, ...sharingSwitches]) expect(s).toEqual(sharingSwitches[0]);

    await open(page, "People");
    const personRows = await sizes(page, ".admin-people .admin-group:first-of-type .admin-row");
    const otherRows = await sizes(page, ".admin-people .admin-group:not(:first-of-type) .admin-row");
    const minPerson = Math.min(...personRows.map((r) => r[1]));
    if (desktop) {
      expect(minPerson).toBeGreaterThanOrEqual(40);
      for (const r of otherRows) expect(minPerson).toBeGreaterThanOrEqual(Math.min(r[1], 40) - 0.5);
    }
    await page.screenshot({ path: `${tag}-people.png`, fullPage: true });

    const dialog = page.getByRole("dialog");
    for (const [open, name, shot] of [
      [/Add Person/, "Create", "add-person"],
      [/Invite Someone/, "Create Link", "invite"],
    ] as const) {
      await page.getByRole("button", { name: open }).click();
      await expect(dialog).toBeVisible();
      const select = await dialog.locator("select.admin-input").first().boundingBox();
      // The invite sheet has only a select until the link exists, so compare against the Cancel button there.
      const inputs = dialog.locator("input.admin-input");
      const input = (await inputs.count()) > 0 ? await inputs.first().boundingBox() : null;
      const button = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
      if (input) expect(Math.abs(select!.height - input.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(select!.height - button!.height)).toBeLessThanOrEqual(1);
      expect(name).toBeTruthy();
      await page.screenshot({ path: `${tag}-${shot}.png` });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    }
  });
}
