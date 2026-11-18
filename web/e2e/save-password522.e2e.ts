import { expect, test } from "@playwright/test";

// #522: Safari offers "Save password?" only once history changes after the form
// submit. A successful sign-in must push a history entry right away; a failed
// one must not. Screenshots go to SHOTS_DIR (not committed).
const SHOTS = process.env.SHOTS_DIR ?? "e2e-shots-s522";
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function historyLength(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.history.length);
}

test("failed sign-in does not change history", async ({ page }, info) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  const before = await historyLength(page);
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await historyLength(page)).toBe(before);
  expect(await page.evaluate(() => window.history.state)).toBeNull();
  await page.screenshot({ path: `${SHOTS}/login-failed-${info.project.name}.png` });
});

test("successful sign-in pushes a history entry right away and Back does not show sign-in", async ({ page }, info) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/login-before-${info.project.name}.png` });
  const before = await historyLength(page);
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  expect(await historyLength(page)).toBe(before + 1);
  expect(await page.evaluate(() => window.history.state)).toEqual({ signedIn: true });
  expect(new URL(page.url()).pathname).toBe("/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/login-after-${info.project.name}.png` });
  await page.goBack();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
});
