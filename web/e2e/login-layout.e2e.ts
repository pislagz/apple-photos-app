import { expect, test } from "@playwright/test";

// F1: the "Keep me signed in" box sits inline, left of its label and vertically centred.
test("keep-me-signed-in checkbox is inline, left of its label, centred", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  const label = page.locator("label.login-card__keep");
  await expect(label).toBeVisible();
  const box = await label.locator("input").boundingBox();
  const row = await label.boundingBox();
  const text = await label.evaluate((el) => {
    const range = document.createRange();
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent?.trim());
    range.selectNodeContents(node!);
    const r = range.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  });
  expect(box && row).toBeTruthy();
  expect(box!.x + box!.width).toBeLessThanOrEqual(text.left + 1);
  const boxMid = box!.y + box!.height / 2;
  expect(Math.abs(boxMid - (text.top + text.bottom) / 2)).toBeLessThan(3);
  const width = page.viewportSize()!.width;
  expect(row!.x + row!.width).toBeLessThanOrEqual(width);
});
