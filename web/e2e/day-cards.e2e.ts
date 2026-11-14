import { type Page, expect, test } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function openDays(page: Page) {
  if (await page.locator("aside.sidebar").count()) {
    test.skip(true, "desktop has no Days entry (#217); the period cards are iPhone-only now");
  } else {
    await page.getByRole("tab", { name: "Days", exact: true }).click();
  }
  await expect(page.getByTestId("period-grid-header")).toContainText("Days");
  await expect(page.locator(".period-card--days").first()).toBeVisible();
  await expect
    .poll(() => page.locator(".period-card__image.is-loaded").count(), { timeout: 15000 })
    .toBeGreaterThan(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`Days is a grid of day cards with a header, scrolled to the newest (${scheme})`, async ({ page }, info) => {
    const desktop = info.project.name === "desktop";
    await page.emulateMedia({ colorScheme: scheme });
    if (desktop) await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await openDays(page);

    await expect(page.getByTestId("period-grid-header")).toContainText(/Items?/);
    const cards = page.locator(".period-card--days");
    // The newest card is on screen; the grid has several columns.
    await expect(cards.last()).toBeInViewport();
    const geometry = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(".period-card--days"));
      const tops = new Map<number, number>();
      for (const el of els) {
        const top = Math.round(el.getBoundingClientRect().top + (el.offsetParent?.scrollTop ?? 0));
        tops.set(top, (tops.get(top) ?? 0) + 1);
      }
      const rect = els[0].getBoundingClientRect();
      return { columns: Math.max(...tops.values()), width: rect.width, height: rect.height, dpr: window.devicePixelRatio };
    });
    if (desktop) {
      expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(2);
      expect(geometry.columns).toBeGreaterThanOrEqual(4);
    } else {
      // iPhone (#219): one 230px card per row.
      expect(geometry.height).toBe(230);
      expect(geometry.columns).toBe(1);
    }

    // Sharp key photo: the loaded thumbnail covers the card at the device pixel ratio.
    const sharp = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>(".period-card--days .period-card__image.is-loaded")).every(
        (img) => img.naturalWidth >= Math.min(img.getBoundingClientRect().width * window.devicePixelRatio, img.naturalWidth) - 1,
      ),
    );
    expect(sharp).toBe(true);
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>(".period-card--days img")).map((i) => i.getAttribute("src")),
    );
    for (const src of sizes) expect(src).toMatch(/size=(grid|grid2x|preview)$/);

    // Label bottom-left, white and bold.
    const label = cards.last().locator(".period-card__label");
    const style = await label.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, weight: s.fontWeight };
    });
    expect(style.color).toBe("rgb(255, 255, 255)");
    expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
    const cardBox = (await cards.last().boundingBox())!;
    const labelBox = (await label.boundingBox())!;
    expect(labelBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2);
    expect(labelBox.x).toBeLessThan(cardBox.x + cardBox.width / 2);

    const tag = `${info.project.name}${desktop ? "-1280" : ""}`;
    await page.screenshot({ path: `${SHOTS}/${tag}-period-days-${scheme}.png` });
  });
}

test("tapping a day card opens All Photos at that day", async ({ page }, info) => {
  await signIn(page);
  await openDays(page);
  const card = page.locator(".period-card--days").last();
  const day = (await card.getAttribute("data-period-key"))!;
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await card.click();
  if (info.project.name === "desktop") {
    await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toHaveAttribute("aria-selected", "true");
  } else {
    await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.locator('[data-testid="library-cell"], .mobile-library__row-grid img').first()).toBeVisible();
});
