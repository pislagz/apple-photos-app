import { expect, test } from "@playwright/test";

// #480: desktop date title never blinks while scrolling; "N of M" uses the
// server's total, not the loaded count.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-480";

test("title stays mounted and opaque while scrolling; counts use the total", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.getByTestId("library-cell").first()).toBeVisible();

  const total = await page.evaluate(async () => {
    const me = await (await fetch("/api/me")).json();
    const id = me.libraries[0].id;
    return (await (await fetch(`/api/libraries/${id}/assets?limit=1`)).json()).total as number;
  });

  const title = page.getByTestId("desktop-library-title");
  await expect(title).toBeVisible();
  const scroller = page.getByTestId("library-cell").first().locator("xpath=ancestor::*[contains(@style,'overflow') or contains(@class,'scroll')][1]");
  await page.mouse.move(600, 400);
  const seen = new Set<number>();
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? 400 : -400);
    await page.waitForTimeout(40);
    await expect(title).toHaveCount(1);
    const opacity = await title.evaluate((el) => Number(getComputedStyle(el).opacity));
    seen.add(opacity);
    const inner = await title.evaluate((el) => getComputedStyle(el.firstElementChild!).opacity);
    expect(Number(inner)).toBe(1);
    expect(await title.getAttribute("data-prev")).toBeNull();
  }
  void scroller;
  await page.screenshot({ path: `${SHOTS}/grid-title.png` });

  await page.getByTestId("library-cell").nth(3).dblclick();
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await expect(page.getByTestId("viewer-title")).toContainText(` of ${total.toLocaleString()}`);
  await page.screenshot({ path: `${SHOTS}/viewer-total.png` });
});
