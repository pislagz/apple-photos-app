import { type Page, expect, test } from "@playwright/test";

// #458: desktop admin. The content column scrolls on its own (wheel,
// keyboard, scrollbar) and the sidebar stays fully on screen and usable.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = process.env.SHOTS458 ?? "e2e/screenshots";
const SECTIONS = ["Libraries", "People", "Sharing", "Devices", "Activity", "Settings"];

test.skip(({ isMobile }) => isMobile, "desktop layout only");

async function signIn(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Admin sections" });
const mainTop = (page: Page) => page.locator(".admin-main").evaluate((el) => el.scrollTop);

async function open(page: Page, name: string) {
  await nav(page).getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 }).first()).toBeVisible();
}

// The demo library is small, so most sections fit; a spacer makes each one long.
async function makeLong(page: Page) {
  await page.locator(".admin-main").evaluate((el) => {
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    el.append(spacer);
  });
}

async function expectSidebarInView(page: Page) {
  const vp = page.viewportSize()!;
  const box = (await nav(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  for (const name of SECTIONS) {
    const b = (await nav(page).getByRole("button", { name }).boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

for (const width of [1440, 900]) {
  test(`wheel scrolls every admin page, sidebar stays put (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    for (const name of SECTIONS) {
      await open(page, name);
      await makeLong(page);
      const before = await mainTop(page);
      await page.mouse.move(width - 40, 400);
      await page.mouse.wheel(0, 800);
      await expect.poll(() => mainTop(page)).toBeGreaterThan(before);
      await expectSidebarInView(page);
    }
    // Sidebar links still work from the bottom of a long page.
    await page.locator(".admin-main").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await nav(page).getByRole("button", { name: "People" }).click();
    await expect(page).toHaveURL(/#people$/);
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
    await expect.poll(() => mainTop(page)).toBe(0);
  });
}

test("keyboard scrolls the content from the sidebar and the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await signIn(page);
  await open(page, "Settings");
  await makeLong(page);
  // Focus is on the Settings sidebar button after the click.
  await page.keyboard.press("PageDown");
  await expect.poll(() => mainTop(page)).toBeGreaterThan(300);
  await page.keyboard.press("ArrowDown");
  const afterArrow = await mainTop(page);
  await page.keyboard.press("End");
  const max = await page.locator(".admin-main").evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect.poll(() => mainTop(page)).toBe(max);
  expect(afterArrow).toBeGreaterThan(300);
  await page.keyboard.press("Home");
  await expect.poll(() => mainTop(page)).toBe(0);
  // Nothing focused: Space pages down, like a normal page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(" ");
  await expect.poll(() => mainTop(page)).toBeGreaterThan(300);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 }).first()).toBeAttached();
  await expectSidebarInView(page);
});

test("a short window scrolls the sidebar on its own", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 260 });
  await signIn(page);
  const navTop = () => nav(page).evaluate((el) => el.scrollTop);
  const box = (await nav(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(260.5);
  await page.mouse.move(100, 150);
  await page.mouse.wheel(0, 400);
  await expect.poll(navTop).toBeGreaterThan(0);
  expect(await mainTop(page)).toBe(0);
  await nav(page).getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#settings$/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshot: Settings scrolled to the bottom (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(page);
    await open(page, "Settings");
    await page.mouse.move(1000, 500);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
    const max = await page.locator(".admin-main").evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(max).toBeGreaterThan(0);
    await expect.poll(() => mainTop(page)).toBe(max);
    await expectSidebarInView(page);
    await page.screenshot({ path: `${SHOTS}/458-settings-bottom-${scheme}.png` });
  });
}
