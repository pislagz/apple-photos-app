import { type Page, expect, test } from "@playwright/test";

// #457 / #435: a trackpad pinch steps the desktop grid one size stop, and
// zooms the photo in the viewer; the page itself never zooms.
// Screenshots go to $SHOTS457 (default test-results/shots457, not committed).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.SHOTS457 ?? "test-results/shots457";

async function signIn(page: Page) {
  await page.emulateMedia({ colorScheme: "light" });
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

const gridSlider = (page: Page) => page.locator(".desktop-library__bar-left input[aria-label='Zoom']");

// Cells sharing the first cell's top edge: the grid's column count.
const columns = (page: Page) =>
  page.locator('[data-testid="library-cell"]').evaluateAll((cells) => {
    const top = Math.round(cells[0].getBoundingClientRect().top);
    return cells.filter((cell) => Math.round(cell.getBoundingClientRect().top) === top).length;
  });

// Visible thumbnails have loaded (for the screenshots).
async function thumbsLoaded(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const imgs = [...document.querySelectorAll<HTMLImageElement>('[data-testid="library-cell"] img.fade-image')].filter((img) => {
            const rect = img.getBoundingClientRect();
            return rect.bottom > 60 && rect.top < window.innerHeight - 60;
          });
          const loaded = imgs.filter((img) => img.dataset.loaded === "true").length;
          return imgs.length > 0 && loaded >= imgs.length * 0.9;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.waitForTimeout(400); // fade-in
}

// A real ctrl+wheel through the browser input pipeline (what Chromium sends
// for a trackpad pinch, or a mouse wheel notch with ctrl held).
async function ctrlWheel(page: Page, x: number, y: number, deltaY: number) {
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
}

// A whole trackpad pinch: many small ctrl+wheel events back to back. Sent in
// the page because Playwright's input round trips are slower than a trackpad
// on a loaded machine, which would split the pinch in two.
async function ctrlWheelBurst(page: Page, deltaY: number, count = 30) {
  return page.evaluate(
    ({ deltaY, count }) => {
      const grid = document.querySelector('[data-testid="desktop-library-grid"]')!;
      let prevented = 0;
      for (let i = 0; i < count; i++) {
        const event = new WheelEvent("wheel", { ctrlKey: true, deltaY, clientX: 700, clientY: 450, bubbles: true, cancelable: true });
        grid.dispatchEvent(event);
        if (event.defaultPrevented) prevented++;
      }
      return prevented;
    },
    { deltaY, count },
  );
}

test("a ctrl+wheel pinch steps the grid exactly one stop each way", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  const slider = gridSlider(page);
  const startStop = Number(await slider.inputValue());
  const startColumns = await columns(page);
  await thumbsLoaded(page);
  await page.screenshot({ path: `${SHOTS}/grid-before-pinch-1440-light.png` });

  // Spread: bigger tiles, exactly one stop.
  await ctrlWheel(page, 700, 450, -100);
  await expect(slider).toHaveValue(String(startStop + 1));
  await expect.poll(() => columns(page)).toBeLessThan(startColumns);
  await thumbsLoaded(page);
  await page.screenshot({ path: `${SHOTS}/grid-after-pinch-1440-light.png` });
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // A long pinch the other way (30 events, far past the threshold) after the
  // cooldown: still one stop, back to where it started.
  await page.waitForTimeout(800);
  expect(await ctrlWheelBurst(page, 20)).toBe(30);
  await expect(slider).toHaveValue(String(startStop));
  await page.waitForTimeout(500);
  await expect(slider).toHaveValue(String(startStop));
  expect(await columns(page)).toBe(startColumns);
});

test("Safari gesture events step the grid one stop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  const slider = gridSlider(page);
  const startStop = Number(await slider.inputValue());
  const prevented = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="desktop-library-grid"]')!;
    const fire = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 700, clientY: 450 });
      grid.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const out = [fire("gesturestart", 1)];
    for (const scale of [0.9, 0.8, 0.6, 0.4, 0.3]) out.push(fire("gesturechange", scale));
    out.push(fire("gestureend", 0.3));
    return out;
  });
  expect(prevented.every(Boolean)).toBe(true);
  await expect(slider).toHaveValue(String(startStop - 1));
});

test("a ctrl+wheel pinch zooms the photo in the viewer", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
  const slider = page.getByTestId("viewer-zoom-slider");
  const before = Number(await slider.inputValue());
  const stage = (await page.locator(".desktop-viewer__stage").boundingBox())!;
  for (let i = 0; i < 3; i++) await ctrlWheel(page, stage.x + stage.width / 2, stage.y + stage.height / 2, -40);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(before + 0.5);
  const scale = await page.locator(".desktop-viewer__stage img").first().evaluate((img) => {
    let el: HTMLElement | null = img as HTMLElement;
    while (el && !el.style.transform.includes("scale(")) el = el.parentElement;
    return Number(/scale\(([\d.]+)\)/.exec(el?.style.transform ?? "")?.[1] ?? 1);
  });
  expect(scale).toBeGreaterThan(1.5);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await page.waitForTimeout(600); // the original replaces the preview
  await page.screenshot({ path: `${SHOTS}/viewer-zoomed-1440-light.png` });
});
