import { type Page, expect, test } from "@playwright/test";

// #488: after a swipe the previous photo must never paint again in the
// current page. Samples every frame across the settle and the item swap.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

test("swiping to the next photo never repaints the previous one (#488)", async ({ page, browserName }, info) => {
  test.skip(info.project.name === "desktop", "mobile viewer only");
  void browserName;
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.locator(".mobile-library__cell").nth(3).click();
  const viewer = page.locator(".mobile-viewer");
  await expect(viewer).toBeVisible();
  await expect(page.locator(".mobile-viewer__page--current img").first()).toHaveJSProperty("complete", true);
  await page.waitForTimeout(800);

  // Tag the element showing the first photo; a reused <img> would keep the tag
  // (and keep painting the old photo until the next file decodes).
  const firstSrc = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".mobile-viewer__page--current .viewer-still__main")!;
    img.dataset.old = "1";
    return img.getAttribute("src");
  });

  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, pts: [number, number][]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const vw = page.viewportSize()!.width;
  await send("touchStart", [[vw * 0.8, 400]]);
  for (let i = 1; i <= 8; i++) await send("touchMove", [[vw * 0.8 - (vw * 0.5 * i) / 8, 400]]);
  await send("touchEnd", []);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "e2e-shots-488/after-swipe-" + info.project.name + ".png" });

  const now = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".mobile-viewer__page--current .viewer-still__main")!;
    return { old: img.dataset.old === "1", src: img.getAttribute("src") };
  });
  expect(now.src).not.toBe(firstSrc);
  expect(now.old).toBe(false);
});
