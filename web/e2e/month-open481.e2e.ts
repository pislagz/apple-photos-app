import { type Page, expect, test } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "e2e-shots-481";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

// #481: a Month card (desktop) or Day card (iPhone) opens All Photos already
// at that period, loaded around it. The title must not show another period on
// the way, and the grid must not sit at the bottom of the library first.
test("a Months/Days card opens All Photos at that period with a steady title", async ({ page }, info) => {
  const desktop = info.project.name === "desktop";
  await signIn(page);
  await page.getByRole("tab", { name: desktop ? "Months" : "Days", exact: true }).click();
  const cards = page.locator('[data-testid="period-card"]');
  await expect(cards.first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-1-period-cards.png` });
  const card = cards.nth(Math.floor((await cards.count()) / 2));
  await card.scrollIntoViewIfNeeded();
  const key = (await card.getAttribute("data-period-key")) ?? "";
  expect(key).toMatch(/^\d{4}-\d{2}/);

  const dates = new Map<string, string>();
  const pending: Promise<void>[] = [];
  page.on("response", (res) => {
    if (!/\/assets\?/.test(res.url())) return;
    pending.push(
      res
        .json()
        .then((body: { items?: { id: string; date: string }[] }) => {
          for (const item of body.items ?? []) dates.set(item.id, item.date);
        })
        .catch(() => {}),
    );
  });
  await page.evaluate(() => {
    const w = window as unknown as { __titles: string[] };
    w.__titles = [];
    const tick = () => {
      const t = Array.from(document.querySelectorAll("[data-testid='page-heading'] h1, [data-testid='page-heading'], [data-testid='header-title'], [data-testid='header-subtitle']"))
        .map((el) => (el.textContent ?? "").trim().slice(0, 60))
        .join("|");
      if (w.__titles[w.__titles.length - 1] !== t) w.__titles.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await card.click();
  await expect(page.locator("[data-asset-id]").first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-2-opened-at-period.png` });

  await Promise.all(pending);
  // The period's first photo is in the top row of the grid.
  const grid = page.locator("[data-testid='desktop-library-grid'], [data-testid='library-scroll']").first();
  const cells = await grid.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    return Array.from(el.querySelectorAll<HTMLElement>("[data-asset-id]")).map((cell) => ({
      id: cell.dataset.assetId ?? "",
      top: cell.getBoundingClientRect().top - top,
      height: cell.getBoundingClientRect().height,
    }));
  });
  const inPeriod = cells.filter((cell) => (dates.get(cell.id) ?? "").startsWith(key));
  expect(inPeriod.length).toBeGreaterThan(0);
  const first = inPeriod.reduce((a, b) => (a.top <= b.top ? a : b));
  expect(first.top).toBeGreaterThanOrEqual(-first.height);
  expect(first.top).toBeLessThan(first.height * 1.5);

  // After the first render of All Photos the title never changes again.
  const titles = await page.evaluate(() => (window as unknown as { __titles: string[] }).__titles);
  console.log(info.project.name, key, JSON.stringify(titles));
  const settled = titles.slice(titles.findIndex((t, i) => i > 0 && !/Months|Days/.test(t)));
  expect(new Set(settled).size).toBeLessThanOrEqual(1);
});
