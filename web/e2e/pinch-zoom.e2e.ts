import { expect, test, type Page } from "@playwright/test";

// Dev-only login printed by scripts/dev_demo.py for the synthetic demo library.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
}

// Two fingers on the grid, 100 px apart, spreading to `endGap` px.
async function pinch(page: Page, endGap: number) {
  await page.evaluate((gap) => {
    const target = document.querySelector('[data-testid="library-scroll"]')!;
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const touches = (spread: number) =>
      [-1, 1].map(
        (side, id) => new Touch({ identifier: id, target, clientX: cx + (side * spread) / 2, clientY: cy }),
      );
    const fire = (type: string, list: Touch[]) =>
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: list }));
    fire("touchstart", touches(100));
    fire("touchmove", touches(gap));
    fire("touchend", []);
  }, endGap);
}

const cellWidth = (page: Page) => page.locator(".mobile-library__cell").first().evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("iPhone pinch walks 1 / 3 / 5 columns, Months and Years (#213)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "iPhone layout only");
  await openLibrary(page);
  const width = await page.locator(".mobile-library__scroll").evaluate((el) => el.clientWidth);
  expect(await cellWidth(page)).toBe(Math.round((width - 4) / 3));

  await pinch(page, 300); // spread: zoom in
  await expect.poll(() => cellWidth(page)).toBe(width);

  await pinch(page, 70); // pinch together: zoom out to 3 columns, then 5
  await expect.poll(() => cellWidth(page)).toBe(Math.round((width - 4) / 3));
  await pinch(page, 70);
  await expect.poll(() => cellWidth(page)).toBe(Math.round((width - 8) / 5));

  await pinch(page, 70);
  await expect(page.getByRole("tab", { name: "Months", exact: true })).toHaveAttribute("aria-selected", "true");
  await pinch(page, 70);
  await expect(page.getByRole("tab", { name: "Years", exact: true })).toHaveAttribute("aria-selected", "true");
  await pinch(page, 150);
  await expect(page.getByRole("tab", { name: "Months", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("a pinch does not open the photo under the fingers; a later tap does (#213)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "iPhone layout only");
  await openLibrary(page);
  await pinch(page, 105); // too small to change level
  await page.locator(".mobile-library__cell").first().dispatchEvent("click");
  await expect(page.locator(".mobile-viewer")).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.locator(".mobile-library__cell").first().click();
  await expect(page.locator(".mobile-viewer")).toBeVisible();
});

test("reduced motion switches level without a fading copy (#213)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "iPhone layout only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLibrary(page);
  await pinch(page, 300);
  await expect(page.locator(".mobile-library__zoom-ghost")).toHaveCount(0);
  await expect(page.locator(".mobile-library__zoom-layer.is-fading-in")).toHaveCount(0);
});

test("desktop has no pinch layer (#213)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("library-cell").first()).toBeVisible();
  await expect(page.locator(".mobile-library__zoom-layer")).toHaveCount(0);
});
