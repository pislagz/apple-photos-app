import { type Page, expect, test } from "@playwright/test";

// #311: Libraries list and detail, Add via the picker, Remove sheet, empty state.
// Screenshots go to SHOTS_DIR (default e2e/screenshots).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "e2e/screenshots";

async function open(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal scroll").toBeLessThanOrEqual(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`libraries (${scheme})`, async ({ page, isMobile }, info) => {
    if (isMobile && scheme === "dark") test.skip();
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${SHOTS}/${info.project.name}-${scheme}`;
    await open(page);

    // List: status in words, no path, no table.
    const list = page.getByRole("list", { name: "Libraries" });
    await expect(list).toContainText(/Ready · [\d,]+ photos/);
    await expect(list).not.toContainText(/\/|\d{4}-\d{2}-\d{2}/);
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Load status" })).toHaveCount(0);
    await noSideScroll(page);
    await page.screenshot({ path: `${tag}-1-list.png`, fullPage: true });

    // A row that is still being read, with its progress bar (status faked).
    await page.route("**/api/admin/libraries/*/status", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, index_state: "indexing", last_indexed_at: null, asset_count: null, index_progress: { done: 312, total: 1200 } },
      });
    });
    await page.reload();
    await expect(page.getByRole("progressbar", { name: "Indexing progress" }).first()).toBeVisible();
    await expect(list).toContainText("Reading photos… · 312 of 1,200 photos");
    await page.screenshot({ path: `${tag}-2-indexing.png`, fullPage: true });
    await page.unroute("**/api/admin/libraries/*/status");
    await page.reload();

    // Detail page: every action has an (i) and the Remove sheet confirms.
    await list.getByRole("button").first().click();
    await expect(page.getByRole("button", { name: "‹ Libraries" })).toBeVisible();
    await expect(page.getByRole("button", { name: "About check for changes" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${tag}-3-detail.png`, fullPage: true });
    await page.getByRole("button", { name: "Remove…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your photos and the library file are not deleted.");
    await page.screenshot({ path: `${tag}-4-remove-sheet.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "‹ Libraries" }).click();

    // Add Library: the picker.
    await page.getByRole("button", { name: "Add Library…" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Libraries found" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${tag}-5-add-picker.png` });
    await dialog.getByRole("button", { name: "Close" }).click();

    // Empty state (library list faked as empty).
    await page.route("**/api/admin/libraries", async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ json: [] });
      else await route.continue();
    });
    await page.reload();
    await expect(page.getByText("No libraries yet")).toBeVisible();
    await expect(page.getByText("How do I connect a folder?")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${tag}-6-empty.png`, fullPage: true });

    expect(errors, "page errors").toEqual([]);
  });
}
