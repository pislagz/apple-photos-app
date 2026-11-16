import { type Page, expect, test } from "@playwright/test";

// #472: AutoFill off on Add Library fields; sign-in keeps its tokens.
// Screenshots go to SHOTS_DIR (default e2e-shots-472, not committed).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "e2e-shots-472";

async function expectOff(page: Page, label: string) {
  const el = page.getByLabel(label, { exact: true });
  await expect(el).toHaveAttribute("autocomplete", "off");
  await expect(el).toHaveAttribute("data-form-type", "other");
  await expect(el).toHaveAttribute("spellcheck", "false");
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
});

test("login screen keeps username and current-password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await page.screenshot({ path: `${SHOTS}/login-1440.png` });
});

test("Add Library fields have AutoFill off", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Add Library…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("list", { name: "Libraries found" })).toBeVisible();
  await dialog.getByText("Advanced").click();
  await expect(page.getByLabel("Path")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-add-library-advanced-1440.png` });
  await expectOff(page, "Path");
  await expectOff(page, "Name (optional)");
  await expect(page.getByLabel("Path").locator("xpath=ancestor::form")).toHaveAttribute("autocomplete", "off");

  // Step 2: name for a picked package.
  const add = dialog.getByRole("button", { name: /^Add .*\.photoslibrary$/ });
  if (await add.count()) {
    await add.first().click();
    await expectOff(page, "Name");
    await page.screenshot({ path: `${SHOTS}/admin-add-library-name-1440.png` });
  }
});
