import { expect, test } from "@playwright/test";

// P3.3 acceptance against the demo server (scripts/dev_demo.py): start the
// pre-warm from the library page, watch it finish, clear the cache.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

test("pre-warm thumbnails from the library card", async ({ page }, info) => {
  test.setTimeout(240_000); // 520 demo assets x 2 sizes take ~30 s on a small box
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 401/.test(m.text())) errors.push(m.text());
  });

  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();

  await page.getByRole("list", { name: "Libraries" }).getByRole("button").first().click();
  const card = page.getByRole("list").filter({ hasText: "Thumbnail cache" }).first();
  // Start from a clean slate so the run is repeatable on the same demo.
  await card.getByRole("button", { name: "Delete Cache…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete Cache" }).click();
  await expect(card).toContainText("Not prepared yet");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-prewarm-idle.png` });

  await card.getByRole("button", { name: "Prepare Thumbnails" }).click();
  await expect(card).toContainText(/Preparing [1-9]/);
  await expect(card.getByRole("progressbar", { name: "Thumbnail progress" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-prewarm-running.png` });

  await expect(card).toContainText(/All \d+ are ready/, { timeout: 180_000 });
  await expect(card.getByRole("button", { name: "Prepare Again" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-prewarm-done.png` });

  await card.getByRole("button", { name: "Delete Cache…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete Cache" }).click();
  await expect(card).toContainText(/Deleted .* of thumbnails\./);
  await expect(card).toContainText("Not prepared yet");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-11-prewarm-cleared.png` });

  expect(errors, "console errors").toEqual([]);
});
