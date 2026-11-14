import { type Page, expect, test } from "@playwright/test";

// #217: resizable sidebar, section titles, toolbar polish, Photos shortcuts.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout only");
});

test("sidebar: no Days entry, sentence-case titles, resizes within 190-300 and remembers", async ({ page }) => {
  await signIn(page);
  const side = page.locator("aside.sidebar");
  await expect(side.getByRole("button", { name: "Days", exact: true })).toHaveCount(0);
  await expect(side.locator(".sidebar__group > summary").first()).toHaveText("Photos");
  await expect(side.getByRole("button", { name: "Library", exact: true })).toHaveCSS("height", "28px");

  const width = async () => Math.round((await side.boundingBox())!.width);
  expect(await width()).toBe(220);
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.up();
  expect(await width()).toBe(300);
  await page.mouse.move(300, 300);
  const box2 = (await handle.boundingBox())!;
  await page.mouse.move(box2.x + 3, box2.y + 200);
  await page.mouse.down();
  await page.mouse.move(20, box2.y + 200);
  await page.mouse.up();
  expect(await width()).toBe(190);

  await page.reload();
  await expect(side).toBeVisible();
  expect(await width()).toBe(190);
});

test("toolbar: slim zoom slider, selection subtitle, search grows on focus", async ({ page }) => {
  await signIn(page);
  const slider = page.getByLabel("Zoom", { exact: true });
  expect(Math.round((await slider.boundingBox())!.width)).toBe(110);
  const search = page.locator(".shell__search .search-box");
  const before = (await search.boundingBox())!.width;
  expect(Math.round(before)).toBe(140);
  await page.getByRole("searchbox").first().focus();
  await expect.poll(async () => Math.round((await search.boundingBox())!.width)).toBe(220);
  await page.getByRole("searchbox").first().blur();

  const cells = page.getByTestId("library-cell");
  await expect(cells.first()).toBeVisible();
  await cells.nth(0).click();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("selection-count")).toHaveText(/^2 of [\d,]+\+? selected$/);
});

test("shortcuts: Space opens and closes the viewer, Cmd I, Cmd + zoom, none while typing", async ({ page }) => {
  await signIn(page);
  const cells = page.getByTestId("library-cell");
  await expect(cells.first()).toBeVisible();
  await cells.nth(1).click();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);

  await cells.nth(1).click();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("desktop-viewer")).toBeVisible();
  await page.keyboard.press("Control+ArrowUp");
  await expect(page.getByTestId("desktop-viewer")).toHaveCount(0);

  const slider = page.getByLabel("Zoom", { exact: true });
  const start = Number(await slider.inputValue());
  await page.keyboard.press("Control+=");
  await expect.poll(async () => Number(await slider.inputValue())).toBe(start + 1);
  await page.keyboard.press("Control+-");
  await expect.poll(async () => Number(await slider.inputValue())).toBe(start);

  const info = page.getByRole("button", { name: "Info" });
  await page.keyboard.press("Control+i");
  await expect(info).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+i");
  await expect(info).toHaveAttribute("aria-pressed", "false");

  const selectionBefore = await page.getByTestId("selection-count").innerText();
  await page.getByRole("searchbox").first().focus();
  await page.keyboard.press("Control+i");
  await page.keyboard.press("Control+a");
  await expect(info).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("selection-count")).toHaveText(selectionBefore);
});
