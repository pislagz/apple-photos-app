import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// #364 no page scroll in select mode, #366 Cmd/Ctrl+A selects tiles and never
// the browser text, #373 centred "Keep me signed in".
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots/1114a";
mkdirSync(SHOTS, { recursive: true });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

const noPageScroll = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return { sh: d.scrollHeight, ch: d.clientHeight, bh: document.body.scrollHeight };
  });

test("select mode adds no page scroll", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await signIn(page);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  let m = await noPageScroll(page);
  expect(m.sh).toBe(m.ch);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByTestId("select-bar")).toBeVisible();
  await page.waitForTimeout(500);
  m = await noPageScroll(page);
  expect(m.sh).toBe(m.ch);
  expect(m.bh).toBeLessThanOrEqual(m.ch);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-select-mode.png` });
});

test("Cmd/Ctrl+A selects every tile and no browser text", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "keyboard shortcut: desktop");
  await signIn(page);
  await page.locator("[data-asset-id]").first().waitFor();
  await page.mouse.click(700, 450);
  await page.keyboard.press("Control+a");
  await expect.poll(() => page.locator("[data-asset-id][data-selected='true']").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("");
  // Every rendered tile is selected (the grid is virtualised, so compare in-page).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll("[data-asset-id]")];
        return tiles.length > 0 && tiles.every((t) => t.getAttribute("data-selected") === "true");
      }),
    )
    .toBe(true);
  await page.screenshot({ path: `${SHOTS}/desktop-select-all.png` });
});

test("Ctrl+A in the search field still selects its text", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop");
  await signIn(page);
  const field = page.getByRole("searchbox").first();
  await field.fill("hello");
  await field.press("Control+a");
  expect(await field.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(5);
});

test("Keep me signed in row is centred", async ({ page }, info) => {
  await page.context().clearCookies();
  await page.goto("/");
  const label = page.locator("label.login-card__keep");
  await expect(label).toBeVisible();
  const row = (await label.boundingBox())!;
  const content = await label.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { left: b.left, right: b.right };
  });
  const input = (await label.locator("input").boundingBox())!;
  const left = content.left - row.x;
  const right = row.x + row.width - content.right;
  expect(Math.abs(left - right)).toBeLessThanOrEqual(3);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-login.png` });
});
