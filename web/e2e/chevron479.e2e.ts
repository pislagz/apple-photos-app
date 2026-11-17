import { mkdirSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// #479: on the iPhone Filter menu the chevron's ink is centred on the label's
// cap-height box (within 0.5px). Measured from a 3x screenshot of each row.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const OUT = process.env.SHOT_DIR ?? "e2e-shots-479";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
}

/** Ink rows of a text node (first letter only) and of the chevron svg path,
 *  read back from the rendered pixels of the row. */
async function measure(page: Page, row: ReturnType<Page["locator"]>, name: string) {
  mkdirSync(OUT, { recursive: true });
  const box = (await row.boundingBox())!;
  const png = await page.screenshot({ clip: box });
  const info = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = el.querySelector(".filter-menu__text")!;
    const range = document.createRange();
    range.setStart(t.firstChild!, 0);
    range.setEnd(t.firstChild!, 1);
    const tr = range.getBoundingClientRect();
    const c = el.querySelector(".filter-menu__chevron svg")!.getBoundingClientRect();
    return { rx: r.x, ry: r.y, tx0: tr.left - r.x, tx1: tr.right - r.x, cx0: c.left - r.x, cx1: c.right - r.x };
  });
  return { png, info };
}

test("chevron ink is centred on the label cap box", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "phone layout only");
  await signIn(page);
  await page.getByRole("button", { name: "Filter", exact: true }).tap();
  const menu = page.getByRole("menu", { name: "Filter" });
  await expect(menu).toBeVisible();
  await page.waitForTimeout(600);
  const rows = menu.locator(".filter-menu__row--parent");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  const results: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const m = await measure(page, rows.nth(i), `row${i}`);
    results.push(m);
  }
  await page.screenshot({ path: `${OUT}/menu-closed-rows.png`, clip: (await menu.boundingBox())! });
  await menu.locator(".filter-menu__row--parent").first().tap();
  await page.waitForTimeout(600);
  const header = menu.locator(".filter-menu__card-header");
  await expect(header).toBeVisible();
  await page.screenshot({ path: `${OUT}/menu-open-card.png`, clip: (await menu.boundingBox())! });
  results.push(await measure(page, header, "header"));
  // Pixel analysis is done by scripts/measure; here we assert via the Python-free path below.
  const rowsInfo = results as { png: Buffer; info: Record<string, number> }[];
  const out = [];
  for (const [i, m] of rowsInfo.entries()) {
    const ink = await page.evaluate(
      async ({ b64, info }) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const k = 3;
        const rowsOf = (x0: number, x1: number) => {
          const d = g.getImageData(Math.floor(x0 * k), 0, Math.ceil((x1 - x0) * k), img.height).data;
          const w = Math.ceil((x1 - x0) * k);
          const bg = [d[0], d[1], d[2]];
          let lo = -1;
          let hi = -1;
          for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < w; x++) {
              const p = (y * w + x) * 4;
              const diff = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
              if (diff > 90) {
                if (lo < 0) lo = y;
                hi = y;
                break;
              }
            }
          }
          return { top: lo / k, bottom: (hi + 1) / k };
        };
        return { text: rowsOf(info.tx0, info.tx1), chev: rowsOf(info.cx0, info.cx1) };
      },
      { b64: m.png.toString("base64"), info: m.info },
    );
    const tc = (ink.text.top + ink.text.bottom) / 2;
    const cc = (ink.chev.top + ink.chev.bottom) / 2;
    out.push({ i, textCentre: tc, chevCentre: cc, delta: cc - tc, ink });
  }
  console.log("MEASURE479 " + JSON.stringify(out));
  for (const o of out) expect(Math.abs(o.delta)).toBeLessThanOrEqual(0.5);
});
