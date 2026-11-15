import { type Page, expect, test } from "@playwright/test";

// #423: the phone grid title is the label colour at the top in light mode and
// white over photos; white at both in dark mode.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/423";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone viewport only");
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".tab-bar")).toBeVisible({ timeout: 20000 });
}

// color-mix() computes to "color(srgb r g b)" with 0..1 channels; rgb() has 0..255.
function channels(color: string) {
  const n = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return color.startsWith("color(srgb") ? n.map((v) => Math.round(v * 255)) : n;
}

async function colours(page: Page, sel: string) {
  return page
    .locator(sel)
    .first()
    .evaluate((el) => getComputedStyle(el).color);
}

async function scrollTo(page: Page, top: number) {
  // The Library opens scrolled to its end (#224) and re-pins it while it
  // loads, so keep scrolling until the position has held for a moment.
  const bar = page.locator("[data-testid=top-bar]:visible").first();
  const scroller = page.locator(".mobile-library__scroll:visible").first();
  const want = top === 0 ? "0" : "1";
  const read = async () => {
    await scroller.evaluate((el, t) => (el.scrollTop = t), top);
    await page.waitForTimeout(250);
    return bar.evaluate((el) =>
      el.hasAttribute("data-scrim")
        ? el.style.getPropertyValue("--title-scrim")
        : "",
    );
  };
  await expect(async () => {
    const first = await read();
    const second = await read();
    if (first !== "" || second !== "")
      expect([first, second]).toEqual([want, want]);
  }).toPass({ timeout: 10000 });
}

for (const scheme of ["light", "dark"] as const) {
  test(`#423 All Photos title colour (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page
      .locator(".tab-bar")
      .getByRole("button", { name: "Library" })
      .click();
    await page.getByRole("tab", { name: "All Photos" }).click();
    const title = ".mobile-library__large-title";
    const sub = ".mobile-library__subtitle";
    await scrollTo(page, 0);
    const top = await colours(page, title);
    const topSub = await colours(page, sub);
    await page.screenshot({ path: `${SHOTS}/all-top-${scheme}.png` });
    await scrollTo(page, 400);
    const scrolled = await colours(page, title);
    await page.screenshot({ path: `${SHOTS}/all-scrolled-${scheme}.png` });
    expect(channels(scrolled)).toEqual([255, 255, 255]);
    if (scheme === "light") {
      expect(Math.max(...channels(top))).toBeLessThan(80);
      expect(Math.max(...channels(topSub))).toBeLessThan(160);
    } else {
      expect(channels(top)).toEqual([255, 255, 255]);
    }
  });

  test(`#423 pushed grids' title and back stay readable (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const tabs = page.locator(".tab-bar");
    const check = async (name: string) => {
      const title = ".mobile-library__nav-title";
      await expect(page.locator(title)).toBeVisible();
      for (const top of [0, 400]) {
        await scrollTo(page, top);
        const c = await colours(page, title);
        if (scheme === "light")
          expect(Math.max(...channels(c)), `${name} @${top}`).toBeLessThan(80);
        else expect(channels(c), `${name} @${top}`).toEqual([255, 255, 255]);
        await page.screenshot({
          path: `${SHOTS}/${name}-${top === 0 ? "top" : "scrolled"}-${scheme}.png`,
        });
      }
    };
    await tabs.getByRole("button", { name: "More" }).click();
    await page
      .getByRole("button", { name: "Videos", exact: true })
      .first()
      .click();
    await check("videos");
    await page.locator(".mobile-library__back").click();
    await tabs.getByRole("button", { name: "Albums" }).click();
    await page
      .locator(".mobile-albums__item, .album-card, [data-testid^='album']")
      .first()
      .click();
    await check("album");
  });
}
