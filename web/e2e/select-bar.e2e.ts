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
