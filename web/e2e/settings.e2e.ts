import { type Page, expect, test } from "@playwright/test";

// #312: the regrouped Settings screen. Instant save, ready choices only.
// Screenshots: web/e2e/screenshots/312-<project>-<scheme>*.png
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

async function openSettings(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByLabel("On computers", { exact: true })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`settings (${scheme})`, async ({ page, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openSettings(page);

    // Phone rows are at least 44px.
    if (isMobile) {
      const row = page.locator(".admin-settings .admin-row").first();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // No technical words in the page body (the (i) text is hidden until opened).
    const body = (await page.locator(".admin-settings").innerText()).toLowerCase();
    for (const word of ["seconds", "bytes", "pwa", "pmtiles", "tailnet"]) expect(body).not.toContain(word);

    // Instant save: change a choice, see "Saved", then put it back.
    const select = page.getByLabel("Largest download at once", { exact: true });
    const before = await select.inputValue();
    await select.selectOption({ label: before === String(5 * 1024 ** 3) ? "2 GB" : "5 GB" });
    await expect(page.getByText("Saved").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/312-${info.project.name}-${scheme}-saved.png` });
    await select.selectOption(before);

    await page.screenshot({ path: `${SHOTS}/312-${info.project.name}-${scheme}.png`, fullPage: true });

    await page.getByText("Advanced", { exact: true }).click();
    await expect(page.getByLabel("Who can open the app", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/312-${info.project.name}-${scheme}-advanced.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("deep link scrolls to Map and place names", async ({ page }) => {
  await page.goto("/admin#map-place-names");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Map and place names" })).toBeInViewport();
});
