import { type Page, expect, test } from "@playwright/test";

// T7: the mobile grid re-lays out live on viewport changes, no reload.
const SHOTS = process.env.RESIZE_SHOTS ?? "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo-user");
  await page.getByLabel("Password").fill("demo-user-pass-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

async function expectTight(page: Page) {
  await expect
    .poll(async () => {
      // Tiles must fill the grid container itself, whatever the viewport.
      const width = await page.locator(".mobile-library__cell").first().evaluate((el) => {
        let p = el.parentElement;
        while (p && getComputedStyle(p).overflowY !== "auto" && getComputedStyle(p).overflowY !== "scroll") p = p.parentElement;
        return (p ?? document.body).getBoundingClientRect().width;
      });
      // Tiles fill the width (the existing 1px column gutters overshoot by <= 3px). Group by grid row, then compare bounding boxes.
      const sorted = await page.locator(".mobile-library__row-grid").evaluateAll((rowEls) =>
        rowEls
          .map((row) =>
            [...row.querySelectorAll(".mobile-library__cell-wrap")].map((c) => {
              const r = c.getBoundingClientRect();
              return { l: r.left, r: r.right, t: r.top, b: r.bottom };
            }),
          )
          .filter((cells) => cells.length)
          .sort((x, y) => x[0].t - y[0].t),
      );
      if (sorted.length < 4) return "few rows";
      for (let i = 0; i < sorted.length - 1; i++) {
        const cells = sorted[i];
        const left = Math.min(...cells.map((c) => c.l));
        const right = Math.max(...cells.map((c) => c.r));
        if (Math.abs(left) > 1.5 || right < width - 1.5 || right > width + 4) return `row ${i} not full width: ${JSON.stringify(cells)} of ${width}`;
      }
      for (let i = 1; i < sorted.length; i++) {
        const prevBottom = Math.max(...sorted[i - 1].map((c) => c.b));
        if (Math.abs(sorted[i][0].t - prevBottom) > 1.5) return `gap before row ${i}: ${prevBottom} -> ${sorted[i][0].t}`;
      }
      return "ok";
    })
    .toBe("ok");
}

test("mobile grid re-lays out on viewport resize without reload", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "mobile layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
  const first = page.getByRole("img").first();
  await expect(first).toBeVisible();
  await expectTight(page);
  await page.screenshot({ path: `${SHOTS}/before-390.png` });

  for (const [w, h] of [[600, 700], [320, 568], [430, 932]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await expectTight(page);
  }
  await page.setViewportSize({ width: 600, height: 700 });
  await expectTight(page);
  await page.screenshot({ path: `${SHOTS}/after-600.png` });
});
