import { type Page, expect, test } from "@playwright/test";

// #256: choose, crop, show and remove an avatar. Desktop menu and iPhone popover,
// light and dark. Needs the demo server (scripts/dev_demo.py).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`avatar (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test(`choose, crop, show and remove (${scheme})`, async ({ page }, info) => {
      const name = info.project.name;
      if (name === "small") test.skip(true, "desktop and iPhone only");
      const desktop = name === "desktop";
      await signIn(page);
      await page.request.delete("/api/me/avatar");
      await page.reload();
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Account menu" }).click();
      if (desktop) {
        await expect(page.getByRole("menuitem", { name: "Choose Avatar…" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Remove Avatar" })).toHaveCount(0);
      } else {
        // Change password, Passkeys and Log out look like Admin / Choose avatar, not disabled.
        const colours = await page
          .locator(".account-menu__popover button")
          .evaluateAll((els) => els.map((el) => [el.textContent, getComputedStyle(el).color]));
        const actions = colours.filter(([t]) => /Choose avatar…|Change password|Passkeys|Log out/.test(t ?? ""));
        expect(actions).toHaveLength(4);
        expect(new Set(actions.map(([, c]) => c)).size).toBe(1);
      }
      await page.screenshot({ path: `${SHOTS}/${name}-avatar-${scheme}-1-menu.png` });

      await (desktop
        ? page.getByRole("menuitem", { name: "Choose Avatar…" }).click()
        : page.getByRole("button", { name: "Choose avatar…" }).click());
      const dialog = page.getByRole("dialog", { name: "Choose a photo" });
      await expect(dialog).toBeVisible();
      const first = dialog.getByRole("listitem").first();
      await expect(first.locator("img")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${name}-avatar-${scheme}-2-pick.png` });
      await first.click();

      const stage = page.getByRole("group", { name: /Drag the photo/ });
      await expect(stage).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
      await stage.focus();
      await page.getByRole("dialog").getByLabel("Zoom", { exact: true }).fill("2");
      await page.keyboard.press("ArrowLeft");
      const box = (await stage.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 4 });
      await page.mouse.up();
      await page.screenshot({ path: `${SHOTS}/${name}-avatar-${scheme}-3-crop.png` });

      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const img = page.locator(desktop ? ".account-menu__row-trigger img" : ".account-menu__popover img, .account-menu img").first();
      if (!desktop) await page.getByRole("button", { name: "Account menu" }).click();
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth))
        .toBe(256);
      await page.screenshot({ path: `${SHOTS}/${name}-avatar-${scheme}-4-shown.png` });

      // Everyone signed in can read it; a broken file falls back to the initial.
      expect((await page.request.get(`/api/users/${USER.username}/avatar`)).status()).toBe(200);

      if (desktop) {
        await page.getByRole("button", { name: "Account menu" }).click();
        await page.getByRole("menuitem", { name: "Remove Avatar" }).click();
      } else {
        await page.getByRole("button", { name: "Remove avatar" }).click();
      }
      await expect(page.locator(".account-menu__avatar img")).toHaveCount(0);
      expect((await page.request.get(`/api/users/${USER.username}/avatar`)).status()).toBe(404);
    });
  });
}
