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

async function openZoom(page: Page, label: "Years" | "Months") {
  if (await page.locator("aside.sidebar").count()) {
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  }
  await page.getByRole("tab", { name: label, exact: true }).click();
  await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("period-card").first()).toBeVisible();
  // Key photos loaded (not the neutral placeholder).
  await expect
    .poll(() => page.locator(".period-card__image.is-loaded").count(), { timeout: 15000 })
    .toBeGreaterThan(0);
}

// Cards per visual row, from their positions.
async function columnsOf(page: Page): Promise<{ columns: number; widest: number; viewport: number }> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="period-card"]'));
    const tops = new Map<number, number>();
    for (const card of cards) {
      const top = Math.round(card.getBoundingClientRect().top + (card.offsetParent?.scrollTop ?? 0));
      tops.set(top, (tops.get(top) ?? 0) + 1);
    }
    const grid = document.querySelector<HTMLElement>('[data-testid="period-grid"]')!;
    return {
      columns: Math.max(...tops.values()),
      widest: Math.max(...cards.map((c) => c.getBoundingClientRect().width)),
      viewport: grid.getBoundingClientRect().width,
    };
  });
}

const WIDTHS = [1280, 1920];

for (const scheme of ["light", "dark"] as const) {
  test(`Years and Months are card grids, scrolled to the newest (${scheme})`, async ({ page }, info) => {
    const desktop = info.project.name === "desktop";
    await page.emulateMedia({ colorScheme: scheme });
    const widths = desktop ? WIDTHS : [null];
    await signIn(page);
    for (const width of widths) {
      if (width) await page.setViewportSize({ width, height: 900 });
      const tag = `${info.project.name}${width ? `-${width}` : ""}`;
      for (const view of ["Years", "Months"] as const) {
        await openZoom(page, view);
        const { columns, widest, viewport } = await columnsOf(page);
        // Several cards per row (never one full-width tile), and never huge.
        const minColumns = view === "Years" ? 2 : desktop ? 4 : 3;
        const cards = await page.getByTestId("period-card").count();
        expect(columns, `${view} columns at ${tag}`).toBeGreaterThanOrEqual(Math.min(minColumns, cards));
        expect(widest).toBeLessThan(viewport * 0.5);
        expect(widest).toBeLessThan(330);
        // Opens at the newest: the last card is on screen.
        await expect(page.getByTestId("period-card").last()).toBeInViewport();
        await page.screenshot({ path: `${SHOTS}/${tag}-period-${view.toLowerCase()}-${scheme}.png` });
      }
    }
  });
}

test("clicking a year card goes down to Months, and a month card down to the photos", async ({ page }, info) => {
  await signIn(page);
  await openZoom(page, "Years");
  const year = (await page.getByTestId("period-card").last().getAttribute("data-period-key"))!;
  await page.getByTestId("period-card").last().click();
  await expect(page.getByRole("tab", { name: "Months", exact: true })).toHaveAttribute("aria-selected", "true");
  const firstMonth = page.locator(`[data-period-key^="${year}-"]`).first();
  await expect(firstMonth).toBeInViewport();

  const month = (await page.getByTestId("period-card").last().getAttribute("data-period-key"))!;
  await page.getByTestId("period-card").last().click();
  if (info.project.name === "desktop") {
    await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
  } else {
    // iPhone: Months -> Days at that month.
    await expect(page.getByRole("tab", { name: "Days", exact: true })).toHaveAttribute("aria-selected", "true");
  }
  expect(month).toMatch(/^\d{4}-\d{2}$/);
});

test("hovering a card scales its image without moving the layout", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover is a desktop pointer interaction");
  await signIn(page);
  await openZoom(page, "Years");
  const card = page.getByTestId("period-card").last();
  const before = await card.boundingBox();
  await card.hover();
  await expect
    .poll(() => card.locator("img").evaluate((el) => getComputedStyle(el).transform))
    .not.toBe("none");
  const after = await card.boundingBox();
  expect(after).toEqual(before);
});

test("Months cards are as wide as Years cards on desktop at 1440x900", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop card size");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await openZoom(page, "Years");
  const years = await columnsOf(page);
  await openZoom(page, "Months");
  const months = await columnsOf(page);
  // Few Years cards do not fill a row, so compare card width (auto-fill keeps
  // the track width), not the per-row count.
  expect(Math.abs(months.widest - years.widest)).toBeLessThan(1);
});
