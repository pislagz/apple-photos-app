import { type Page, expect, test } from "@playwright/test";

// #409: a trackpad pinch (ctrl+wheel) never zooms the page; in the viewer it
// still zooms the photo.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
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

async function pinchAt(page: Page, x: number, y: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: boolean[] };
    w.__prevented = [];
    // Bubble phase on window, after the app's own listeners ran.
    window.addEventListener("wheel", (event) => w.__prevented.push(event.defaultPrevented), { passive: true });
  });
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -40);
  await page.keyboard.up("Control");
  return page.evaluate(() => ({
    prevented: (window as unknown as { __prevented: boolean[] }).__prevented,
    scale: window.visualViewport?.scale ?? 1,
  }));
}

test("ctrl+wheel on the grid, toolbar and sidebar never zooms the page", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  for (const [x, y] of [[700, 450], [700, 20], [60, 300]]) {
    const result = await pinchAt(page, x, y);
    expect(result.prevented.length).toBeGreaterThan(0);
    expect(result.prevented.every(Boolean)).toBe(true);
    expect(result.scale).toBe(1);
  }
});

test("ctrl+wheel in the viewer still zooms the photo", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await page.locator('[data-testid="library-cell"]').nth(3).dblclick();
  await expect(page.getByTestId("viewer-title")).toContainText(/ of /);
  const slider = page.getByTestId("viewer-zoom-slider");
  const before = Number(await slider.inputValue());
  const stage = (await page.locator(".desktop-viewer__stage").boundingBox())!;
  const result = await pinchAt(page, stage.x + stage.width / 2, stage.y + stage.height / 2);
  expect(result.scale).toBe(1);
  expect(Number(await slider.inputValue())).toBeGreaterThan(before);
});
