import { expect, test, type Page } from "@playwright/test";

// #224: the Library lists oldest first and opens at the newest photo, at the bottom.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-asset-id]").first()).toBeVisible();
}

// Newest asset id, straight from the (newest-first) API; the library id comes from a thumbnail URL.
async function newestFromApi(page: Page): Promise<{ id: string; libraryId: number }> {
  const src = (await page.locator("img[src*='/api/libraries/']").first().getAttribute("src")) ?? "";
  const libraryId = Number(/libraries\/(\d+)\//.exec(src)![1]);
  const id = await page.evaluate(async (lib) => {
    const first = (await (await fetch(`/api/libraries/${lib}/assets?limit=1`)).json()) as { items: { id: string }[] };
    return first.items[0].id;
  }, libraryId);
  return { id, libraryId };
}

for (const scheme of ["light", "dark"] as const) {
  test(`Library opens at the newest photo, older pages load without a jump, ${scheme} (#224)`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iPhone");
    const phone = info.project.name === "iphone";
    const scroller = page.locator(phone ? '[data-testid="library-scroll"]' : '[data-testid="desktop-library-grid"]');
    const shot = (name: string) => page.screenshot({ path: `e2e/screenshots/p224/${info.project.name}-${scheme}-${name}.png` });
    await signIn(page, scheme);
    if (!phone) await expect(page.getByRole("tab", { name: "All Photos", exact: true })).toBeVisible();
    const newest = await newestFromApi(page);

    // Opens scrolled to the end, with the newest photo on screen at the bottom.
    const atEnd = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect.poll(atEnd).toBeLessThan(2);
    const newestCell = page.locator(`[data-asset-id="${newest.id}"]`);
    await expect(newestCell).toBeVisible();
    const newestBox = (await newestCell.boundingBox())!;
    const viewBox = (await scroller.boundingBox())!;
    expect(newestBox.y + newestBox.height).toBeGreaterThan(viewBox.y + viewBox.height - (phone ? 160 : 40));
    await shot("library-newest-at-bottom");

    // Scroll to the top of what is loaded: the next older page is added above, and the
    // photo that was at the top of the screen stays exactly where it was.
    const result = await scroller.evaluate(async (el) => {
      el.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const box = el.getBoundingClientRect();
      const cell = [...el.querySelectorAll<HTMLElement>("[data-asset-id]")].find((c) => c.getBoundingClientRect().top >= box.top);
      if (!cell) return null;
      const id = cell.dataset.assetId!;
      const before = cell.getBoundingClientRect().top;
      const started = Date.now();
      while (el.scrollTop === 0 && Date.now() - started < 8000) await new Promise((resolve) => setTimeout(resolve, 25));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const moved = el.querySelector<HTMLElement>(`[data-asset-id="${id}"]`);
      return { id, before, after: moved ? moved.getBoundingClientRect().top : null, scrollTop: el.scrollTop };
    });
    expect(result).not.toBeNull();
    expect(result!.scrollTop).toBeGreaterThan(0); // older rows were added on top
    expect(result!.after).not.toBeNull();
    expect(Math.abs(result!.after! - result!.before)).toBeLessThan(2); // and nothing jumped
    await scroller.evaluate((el) => (el.scrollTop = el.scrollTop + 1));
    await shot("library-scrolled-up");

    // Re-tapping All (iPhone) / End (desktop) glides back to the newest.
    if (phone) await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    else {
      await page.locator('[data-testid="desktop-library-grid"]').focus();
      await page.keyboard.press("End");
    }
    await expect.poll(atEnd, { timeout: 8000 }).toBeLessThan(2);
    await expect(newestCell).toBeVisible();

    // Months and Years are oldest first too, opening at the newest card.
    for (const name of ["Months", "Years"]) {
      const tab = page.getByRole("tab", { name, exact: true });
      if (await tab.count()) {
        await tab.click();
        await expect(page.locator('[data-testid="period-card"]').first()).toBeVisible();
        await expect.poll(atEnd).toBeLessThan(2);
        await shot(name.toLowerCase());
      }
    }
  });
}

// #365: rows fill left to right from the OLDEST photo; only the last (newest) row is short,
// with its empty space at the bottom right -- at every window size.
for (const scheme of ["light", "dark"] as const) {
  test(`Library rows start full at the oldest photo, short row last at the bottom right, ${scheme} (#365)`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iPhone");
    const phone = info.project.name === "iphone";
    const scroller = page.locator(phone ? '[data-testid="library-scroll"]' : '[data-testid="desktop-library-grid"]');
    const shot = (name: string) => page.screenshot({ path: `e2e/screenshots/p365/${info.project.name}-${scheme}-${name}.png` });
    await signIn(page, scheme);
    const newest = await newestFromApi(page);
    const { total, oldestId } = await page.evaluate(async (lib) => {
      const first = (await (await fetch(`/api/libraries/${lib}/assets?limit=1`)).json()) as { total: number };
      let cursor: string | null = null;
      let last = "";
      do {
        const r = (await (await fetch(`/api/libraries/${lib}/assets?limit=500${cursor ? `&cursor=${cursor}` : ""}`)).json()) as {
          items: { id: string }[];
          next_cursor: string | null;
        };
        last = r.items[r.items.length - 1].id;
        cursor = r.next_cursor;
      } while (cursor);
      return { total: first.total, oldestId: last };
    }, newest.libraryId);

    // Rendered cells grouped into visual rows by their top edge.
    const rowsOnScreen = () =>
      scroller.evaluate((el) => {
        const cells = [...el.querySelectorAll<HTMLElement>("[data-asset-id]")].map((c) => {
          const b = c.getBoundingClientRect();
          return { id: c.dataset.assetId!, top: Math.round(b.top), left: Math.round(b.left) };
        });
        const tops = [...new Set(cells.map((c) => c.top))].sort((a, b) => a - b);
        return tops.map((top) => cells.filter((c) => c.top === top).sort((a, b) => a.left - b.left));
      });
    const loadEverything = async () => {
      let previous = -1;
      for (let i = 0; i < 40; i++) {
        await scroller.evaluate((el) => (el.scrollTop = 0));
        await page.waitForTimeout(250);
        const height = await scroller.evaluate((el) => el.scrollHeight);
        if (height === previous) break;
        previous = height;
      }
    };

    const sizes = phone ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }] : [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 900, height: 700 }];
    let shortLastRows = 0;
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await loadEverything();
      const top = await rowsOnScreen();
      const columns = top[0].length;
      // First row: full, starting at the oldest photo, left-aligned like every row below it.
      expect(top[0][0].id).toBe(oldestId);
      for (const row of top.slice(0, -1)) {
        expect(row).toHaveLength(columns);
        expect(row[0].left).toBe(top[0][0].left);
      }
      await shot(`library-oldest-row-${size.width}x${size.height}`);

      await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(300);
      const bottom = await rowsOnScreen();
      const last = bottom[bottom.length - 1];
      expect(last.map((c) => c.id)).toContain(newest.id);
      expect(last[0].left).toBe(bottom[0][0].left); // left-aligned: empty space on the right
      expect(last).toHaveLength(total % columns || columns);
      if (total % columns) shortLastRows++;
      await shot(`library-newest-row-${size.width}x${size.height}`);
    }
    expect(shortLastRows).toBeGreaterThan(0); // the demo count is not divisible by every column count
  });
}
