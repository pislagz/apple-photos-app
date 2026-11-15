import { expect, test, type Page } from "@playwright/test";

// #259: the iPhone select bar is laid out like Photos -- Share left, the
// count centred, Download right -- with 44pt targets throughout.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("select bar: Share left, count centred, Download right, 44pt targets", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const bar = page.getByTestId("select-bar");
  await expect(bar).toBeVisible();
  const cells = page.locator("img.mobile-library__cell");
  await cells.nth(0).click();
  await cells.nth(1).click();
  await expect(bar).toContainText(/2 (Photos|Videos|Items) Selected/);
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}-select-bar.png` });

  const share = (await page.getByRole("button", { name: "Share" }).boundingBox())!;
  const download = (await page.getByRole("button", { name: "Download" }).boundingBox())!;
  const count = (await bar.locator(".mobile-library__select-count").boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  const viewport = page.viewportSize()!;

  for (const box of [share, download]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(share.x + share.width).toBeLessThanOrEqual(count.x + 1);
  expect(download.x).toBeGreaterThanOrEqual(count.x + count.width - 1);
  expect(Math.abs(count.x + count.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  // The bar is anchored to the bottom and at least a full toolbar tall.
  expect(Math.round(barBox.y + barBox.height)).toBeGreaterThanOrEqual(viewport.height - 100);
  expect(barBox.height).toBeGreaterThanOrEqual(49);

  const option = page.getByRole("switch", { name: "HEIC as JPEG" });
  if (await option.count()) {
    const box = (await option.locator("xpath=ancestor::label").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThan(viewport.width * 0.8);
  }
});

// #281 F12: the grid's bottom padding follows the bar's full height, so the
// last row is never covered when scrolled to the very bottom.
test("select bar never covers the last row", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const cells = page.locator("img.mobile-library__cell");
  await cells.nth(0).click();
  await cells.nth(1).click();
  const bar = page.getByTestId("select-bar");
  const scroll = page.getByTestId("library-scroll");
  // Page in the whole demo library: scroll until we rest at the end and the
  // height stops growing.
  let previous = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const state = await scroll.evaluate((el) => {
      el.scrollTo(0, el.scrollHeight);
      return { height: el.scrollHeight, atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 1 };
    });
    if (state.atEnd && state.height === previous) break;
    previous = state.height;
  }
  const barBox = (await bar.boundingBox())!;
  const padding = await scroll.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(barBox.height - 1);
  const lowest = await scroll.evaluate((el) =>
    Math.max(...Array.from(el.querySelectorAll("img.mobile-library__cell")).map((i) => i.getBoundingClientRect().bottom)),
  );
  expect(lowest).toBeLessThanOrEqual(barBox.y + 1);
});

// #281 F15: Share hands every selected photo to one share sheet.
test("select bar Share passes all selected photos to one share()", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: number[] };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        w.__shared.push(data.files.length);
      },
      configurable: true,
    });
  });
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const cells = page.locator("img.mobile-library__cell");
  for (const i of [0, 1, 2]) await cells.nth(i).click();
  await page.getByRole("button", { name: "Share" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: number[] }).__shared)).toEqual([3]);
});

// #371: glass buttons like the grid's Select/filter, no overlap at 320 and 390.
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`select bar glass layout ${size.width}px ${scheme}`, async ({ page }, info) => {
      test.skip(info.project.name === "desktop", "phone layout only");
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await signIn(page);
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      const cells = page.locator("img.mobile-library__cell");
      await cells.nth(0).click();
      await cells.nth(1).click();
      const bar = page.getByTestId("select-bar");
      await expect(bar).toContainText(/Selected/);
      await page.screenshot({ path: `e2e/screenshots/371/select-${size.width}-${scheme}.png` });
      const share = page.getByRole("button", { name: "Share" });
      const download = page.getByRole("button", { name: "Download" });
      await expect(share).toHaveClass(/mobile-library__glass-button/);
      const bg = await share.evaluate((el) => getComputedStyle(el).backgroundColor);
      const selectBg = await page.evaluate(() => {
        const probe = document.createElement("button");
        probe.className = "mobile-library__glass-button";
        document.body.appendChild(probe);
        const v = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return v;
      });
      expect(bg).toBe(selectBg);
      const s = (await share.boundingBox())!;
      const d = (await download.boundingBox())!;
      const c = (await bar.locator(".mobile-library__select-count").boundingBox())!;
      expect(s.x).toBeLessThan(c.x);
      expect(s.x + s.width).toBeLessThanOrEqual(c.x + 1);
      expect(d.x).toBeGreaterThanOrEqual(c.x + c.width - 1);
      expect(d.x + d.width).toBeLessThanOrEqual(size.width);
      expect(s.x).toBeGreaterThanOrEqual(0);
    });
  }
}
