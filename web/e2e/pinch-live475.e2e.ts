import { type Page, expect, test } from "@playwright/test";

// #475: a trackpad pinch scales the desktop grid live, then settles on a stop.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-475";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const library = page.locator("aside.sidebar").getByRole("button", { name: "Library" });
  if (await library.isVisible()) await library.click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
}

// A ctrl+wheel event, as Chromium sends a trackpad pinch.
const ctrlWheel = (page: Page, deltaY: number) =>
  page.evaluate((dy) => {
    const grid = document.querySelector('[data-testid="desktop-library-grid"]')!;
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(
      new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }),
    );
  }, deltaY);

// Keeps the pinch alive (tiny events) while a screenshot is taken.
const holdPinch = (page: Page, on: boolean) =>
  page.evaluate((hold) => {
    const w = window as unknown as { __hold?: number };
    if (w.__hold) clearInterval(w.__hold);
    w.__hold = undefined;
    if (!hold) return;
    const grid = document.querySelector('[data-testid="desktop-library-grid"]')!;
    w.__hold = window.setInterval(
      () => grid.dispatchEvent(new WheelEvent("wheel", { deltaY: 0.01, ctrlKey: true, bubbles: true, cancelable: true, clientX: 600, clientY: 400 })),
      30,
    );
  }, on);

const bodyTransform = (page: Page) =>
  page.locator('[data-testid="desktop-library-body"]').first().evaluate((el) => (el as HTMLElement).style.transform);
// Layout width, not the on-screen one: a settle animation scales the tile.
const cellWidth = (page: Page) =>
  page.locator('[data-testid="library-cell"]').first().evaluate((el) => Math.round((el as HTMLElement).offsetWidth));

test("ctrl+wheel pinch scales the grid live, then settles on the next size (#475)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  const before = await cellWidth(page);
  await page.screenshot({ path: `${SHOTS}/1-before.png` });
  // One in-page burst (16 ms apart, well inside the 140 ms settle window):
  // Playwright round-trips between events can outlast it on a loaded box and
  // end the pinch early.
  const seen = await page.evaluate(async () => {
    const grid = document.querySelector('[data-testid="desktop-library-grid"]')!;
    const body = document.querySelector('[data-testid="desktop-library-body"]') as HTMLElement;
    const r = grid.getBoundingClientRect();
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      grid.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -12, ctrlKey: true, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }),
      );
      out.push(Number(/scale\(([\d.]+)\)/.exec(body.style.transform)?.[1] ?? 1));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return out;
  });
  await holdPinch(page, true);
  await page.screenshot({ path: `${SHOTS}/2-mid-pinch-early.png` });
  await holdPinch(page, false);
  await holdPinch(page, true);
  await page.screenshot({ path: `${SHOTS}/3-mid-pinch-late.png` });
  await holdPinch(page, false);
  // Live: the scale grows with every event, before any size change.
  expect(seen[1]).toBeGreaterThan(1);
  expect(seen[3]).toBeGreaterThan(seen[1]);
  expect(await cellWidth(page)).toBe(before);
  // Settled: one size stop bigger and no leftover inline transform.
  await expect.poll(() => cellWidth(page)).toBeGreaterThan(before);
  await expect.poll(() => bodyTransform(page)).toBe("");
  await page.screenshot({ path: `${SHOTS}/4-settled.png` });
});

test("a small ctrl+wheel pinch springs back without changing size (#475)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  const before = await cellWidth(page);
  await ctrlWheel(page, -20);
  await expect.poll(() => bodyTransform(page)).toBe("");
  expect(await cellWidth(page)).toBe(before);
});

test("reduced motion: no live scale, still steps (#475)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const before = await cellWidth(page);
  for (let i = 0; i < 6; i++) {
    await ctrlWheel(page, -30);
    expect(await bodyTransform(page)).toBe("");
  }
  await expect.poll(() => cellWidth(page)).toBeGreaterThan(before);
});
