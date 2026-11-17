import { type Page, expect, test } from "@playwright/test";

// #504: press-and-drag with a mouse selects a range in Select mode at the phone widths.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.SHOT_DIR ?? "e2e-shots-504";

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "desktop", "phone widths only");
});

async function enterSelect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator("[data-asset-id]").first()).toBeVisible({ timeout: 20000 });
}

// Tile i of those fully on screen below the glass header (the grid opens scrolled to the end).
async function center(page: Page, i: number) {
  const vh = page.viewportSize()?.height ?? 600;
  const boxes = await page.locator("[data-asset-id]").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
  );
  const visible = boxes.filter((r) => r.y > 130 && r.y + r.h < vh - 110 && r.x >= 0);
  const box = visible[i];
  if (!box) throw new Error("no visible tile " + i);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

test("mouse drag across tiles selects a range, click still toggles", async ({ page }, info) => {
  await enterSelect(page);
  const tiles = page.locator("[data-asset-id]");
  const a = await center(page, 0);
  const c = await center(page, 2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + c.x) / 2, c.y, { steps: 5 });
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await page.screenshot({ path: `${SHOTS}/504-drag-${info.project.name}.png` });
  await page.mouse.up();
  await page.screenshot({ path: `${SHOTS}/504-after-${info.project.name}.png` });
  // Three tiles on one row, first to last: the header counts them.
  await expect(page.locator("body")).toContainText("3 Selected");
  const n = 3;

  // A plain click after the drag still toggles one tile (the swallowed click must not stick).
  const d = await center(page, 4);
  await page.mouse.click(d.x, d.y);
  await expect(page.locator("body")).toContainText(`${n + 1} Selected`);
  expect(await tiles.count()).toBeGreaterThan(4);
});
