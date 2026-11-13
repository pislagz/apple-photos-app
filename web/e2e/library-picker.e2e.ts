import { expect, test } from "@playwright/test";

// #251: the admin picks a library from the folders the server knows about
// instead of typing a path. The demo server sets PHOTOS_VIEWER_LIBRARIES_DIR.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

test("libraries picker lists found packages; typed path hides under Advanced", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();

  const list = page.getByRole("list", { name: "Libraries found" });
  await expect(list).toContainText("Ready · ");
  await expect(list).toContainText(/photos · [\d.]+ (MB|GB|KB)/);
  await expect(list).toContainText("Already added");

  const path = page.getByLabel("Path");
  await expect(path).toBeHidden();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(path).toBeVisible();
  await path.fill("/nowhere/Demo.photoslibrary");
  await page.getByRole("button", { name: "Add library" }).click();
  await expect(page.getByRole("alert")).toContainText("does not exist");
});
