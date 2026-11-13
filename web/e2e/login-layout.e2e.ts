import { expect, test } from "@playwright/test";

// The Sign in button lines up with the fields instead of overhanging them:
// on desktop the inputs' width and height, on a phone the fields group's
// width at 44pt, sitting below the group rather than fused onto it.
test("Sign in button is sized to the fields", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  const submit = (await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox())!;
  if (info.project.name === "desktop") {
    const input = (await page.getByLabel("Password").boundingBox())!;
    expect(Math.abs(submit.x - input.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.width - input.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.height - input.height)).toBeLessThanOrEqual(1);
  } else {
    const group = (await page.locator(".login-card form > label").last().boundingBox())!;
    expect(Math.abs(submit.x - group.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.width - group.width)).toBeLessThanOrEqual(1);
    expect(submit.height).toBeGreaterThanOrEqual(44);
    expect(submit.height).toBeLessThanOrEqual(50);
    expect(submit.y).toBeGreaterThanOrEqual(group.y + group.height + 8);
  }
});

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
