import { expect, test } from "@playwright/test";

// #308: screenshots of the dev-only admin controls page, light and dark.
// The page exists only in a build made with VITE_ADMIN_GALLERY=1 (or `vite dev`):
//   (cd web && VITE_ADMIN_GALLERY=1 npm run build)
const SHOTS = "e2e/screenshots";

for (const scheme of ["light", "dark"] as const) {
  test(`admin controls page, ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/admin/controls");
    await expect(page.getByRole("heading", { name: "Admin controls", level: 1 })).toBeVisible();
    await expect(page.getByTestId("gallery-compact")).toBeVisible();
    await expect(page.getByTestId("gallery-touch")).toBeVisible();

    // Row heights: 32px and 44px, whatever the viewport.
    const rowHeight = (testId: string) =>
      page.getByTestId(testId).locator(".admin-row").first().evaluate((el) => el.getBoundingClientRect().height);
    expect(await rowHeight("gallery-compact")).toBeGreaterThanOrEqual(32);
    expect(await rowHeight("gallery-compact")).toBeLessThan(44);
    expect(await rowHeight("gallery-touch")).toBeGreaterThanOrEqual(44);

    // Switch toggles and reports its state.
    const sw = page.getByTestId("gallery-touch").getByRole("switch", { name: "Show hidden photos" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();

    await page.screenshot({ path: `${SHOTS}/admin-308-controls-${info.project.name}-${scheme}.png`, fullPage: true });

    // The sheet: Cancel has focus, Escape closes it.
    await page.getByTestId("gallery-touch").getByRole("button", { name: /Remove library/ }).click();
    const dialog = page.getByRole("dialog", { name: "Remove this library?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const cancelHeight = await dialog.getByRole("button", { name: "Cancel" }).evaluate((el) => el.getBoundingClientRect().height);
    expect(cancelHeight).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: `${SHOTS}/admin-308-controls-sheet-${info.project.name}-${scheme}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
