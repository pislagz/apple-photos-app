import { type Page, expect, test } from "@playwright/test";

// #416 mobile viewer title never blank, #412 pill/search same width at rest,
// #413 toolbar hover backgrounds are exactly square.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e/screenshots/416";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function openAllPhotos(page: Page) {
  await signIn(page);
  const library = page.locator("aside.sidebar").getByRole("button", { name: "Library" });
  if (await library.isVisible()) await library.click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
}

async function slowDetail(page: Page) {
  await page.route(/\/api\/libraries\/\d+\/assets\/[^/?]+$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.continue();
  });
}

// Samples the mobile viewer title on every animation frame.
async function stepAndSample(page: Page, step: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __bad: string[]; __stop: boolean; __frames: number };
    w.__bad = [];
    w.__frames = 0;
    w.__stop = false;
    const tick = () => {
      const primary = document.querySelector(".mobile-viewer__title-primary");
      w.__frames++;
      if (!primary || !(primary.textContent ?? "").trim()) w.__bad.push("empty title");
      if (!w.__stop) requestAnimationFrame(tick);
    };
    tick();
  });
  for (let i = 0; i < 8; i++) {
    await step();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const w = window as unknown as { __bad: string[]; __stop: boolean; __frames: number };
    w.__stop = true;
    return { bad: w.__bad, frames: w.__frames };
  });
  expect(result.frames).toBeGreaterThan(20);
  expect(result.bad).toEqual([]);
}

test.describe("#416 mobile viewer title", () => {
  test("iPhone: never empty while stepping", async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iphone project");
    await slowDetail(page);
    await signIn(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator('.mobile-library__cell').nth(3).click();
    await expect(page.locator(".mobile-viewer__title-primary")).toBeVisible();
    await page.waitForTimeout(400);
    await stepAndSample(page, async () => {
      await page.keyboard.press("ArrowRight");
    });
    await page.screenshot({ path: `${OUT}/416-title-iphone.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
  });

  test("narrow desktop window (600px): never empty while stepping", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop project");
    await page.setViewportSize({ width: 600, height: 900 });
    await slowDetail(page);
    await signIn(page);
    await expect(page.locator(".shell--mobile")).toBeVisible();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator('.mobile-library__cell').nth(3).click();
    await expect(page.locator(".mobile-viewer__title-primary")).toBeVisible();
    await page.waitForTimeout(400);
    await stepAndSample(page, async () => {
      await page.keyboard.press("ArrowRight");
    });
    await page.screenshot({ path: `${OUT}/416-title-narrow.png`, clip: { x: 0, y: 0, width: 600, height: 120 } });
  });
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 900]) {
    test(`#412 pill and search: same width and right edge at rest, ${scheme} ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await openAllPhotos(page);
      const pill = (await page.getByRole("button", { name: "Filter By" }).boundingBox())!;
      const search = (await page.locator(".search-box--desktop").boundingBox())!;
      expect(Math.abs(pill.width - search.width), `pill ${pill.width} search ${search.width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(pill.x + pill.width - (search.x + search.width))).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${OUT}/412-rest-${scheme}-${width}.png`, clip: { x: 0, y: 0, width, height: 120 } });
    });

    test(`#413 every toolbar hover background is square and equal, ${scheme} ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await openAllPhotos(page);
      const sizes: string[] = [];
      // What paints the hover: the button's own background (no pseudo-element
      // or child layer may paint a different box).
      const measure = async (page: Page, selector: string, tag: string) => {
        const buttons = page.locator(selector);
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const button = buttons.nth(i);
          if (!(await button.isVisible()) || (await button.isDisabled())) continue;
          const icon = (await button.locator("svg").count()) > 0 && !((await button.textContent()) ?? "").trim();
          if (!icon) continue;
          await button.hover();
          await page.waitForTimeout(200);
          const m = await button.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const pseudo = [getComputedStyle(el, "::before").content, getComputedStyle(el, "::after").content];
            return { w: box.width, h: box.height, bg: style.backgroundColor, pseudo, label: el.getAttribute("aria-label") };
          });
          expect(m.pseudo, `${tag} ${m.label} pseudo`).toEqual(["none", "none"]);
          expect(m.bg, `${tag} ${m.label} paints a hover background`).not.toBe("rgba(0, 0, 0, 0)");
          expect(Math.abs(m.w - m.h), `${tag} ${m.label}: ${m.w}x${m.h}`).toBeLessThanOrEqual(0.5);
          sizes.push(`${Math.round(m.w * 2) / 2}`);
        }
      };
      await measure(page, ".desktop-library__bar-left button.toolbar-button, .desktop-library__bar-right button.toolbar-button", "library");
      await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
      await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
      await measure(page, ".desktop-viewer__topbar button.toolbar-button", "viewer");
      expect(sizes.length, `sizes ${sizes}`).toBeGreaterThanOrEqual(8);
      expect(new Set(sizes).size, `sizes ${sizes}`).toBe(1);
      if (width === 1440) {
        await page.locator(".desktop-viewer__topbar").getByRole("button", { name: "Zoom Out" }).hover();
        await page.screenshot({ path: `${OUT}/413-viewer-zoomout-${scheme}.png`, clip: { x: 0, y: 0, width: 400, height: 60 } });
        await page.locator(".desktop-viewer__topbar").getByRole("button", { name: "Info" }).hover();
        await page.screenshot({ path: `${OUT}/413-viewer-info-${scheme}.png`, clip: { x: width - 400, y: 0, width: 400, height: 60 } });
      }
    });
  }
}
