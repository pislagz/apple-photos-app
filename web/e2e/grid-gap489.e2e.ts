import { expect, test } from "@playwright/test";

const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = process.env.SHOT_DIR ?? "e2e-shots-489";

for (const scheme of ["light", "dark"] as const) {
  test(`mobile grid row gap equals column gap at every zoom, ${scheme} (#489)`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone layout only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill(USER.username);
    await page.getByLabel("Password").fill(USER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
    // Default, one step out, then in to the largest tiles.
    const steps = ["Zoom Out", "Zoom In", "Zoom In", ""];
    for (let level = 0; level < steps.length; level++) {
      const dir = steps[level];
      const menu0 = page.getByRole("menu", { name: "Filter" });
      const gaps = await page.locator(".mobile-library__cell-wrap").evaluateAll((els) => {
        const r = els.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
        const col = r.find((b, i) => r[i + 1] && Math.abs(r[i + 1].top - b.top) < 1);
        const colGap = col ? r[r.indexOf(col) + 1].left - col.right : NaN;
        const lowerAt = r.find((b) => b.top > r[0].top + 1);
        const rowGap = lowerAt ? lowerAt.top - r[0].bottom : NaN;
        return { colGap, rowGap };
      });
      // One column has no column gap to compare: the gap is the same 2px token.
      if (process.env.TAG !== "before") expect(gaps.rowGap).toBeCloseTo(Number.isNaN(gaps.colGap) ? 2 : gaps.colGap, 1);
      if (await menu0.isVisible()) await page.mouse.click(5, 400);
      await page.screenshot({ path: `${OUT}/${process.env.TAG ?? "after"}-${scheme}-zoom${level}.png` });
      if (!dir) break;
      const menu = page.getByRole("menu", { name: "Filter" });
      if (!(await menu.isVisible())) await page.getByRole("button", { name: "Filter", exact: true }).tap();
      const viewOptions = menu.getByRole("menuitem", { name: "View Options" });
      if (await viewOptions.isVisible()) await viewOptions.tap();
      await menu.getByRole("menuitem", { name: dir }).tap();
      await page.waitForTimeout(500);
    }
  });
}
