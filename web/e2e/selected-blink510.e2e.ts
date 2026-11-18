import { type Page, expect, test } from "@playwright/test";

// #510: the "N Selected" subtitle updates in place -- no remount, no fade.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator(".mobile-library__cell").first()).toBeVisible();
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "iphone", "iPhone header only");
});

test("count text changes without remounting or animating (#510)", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Select" }).click();
  const count = page.getByTestId("selected-count");
  await expect(count).toHaveText("None Selected");
  await count.evaluate((el) => {
    (el as HTMLElement & { __mark?: boolean }).__mark = true;
  });
  for (let i = 0; i < 4; i++) {
    await page.locator(".mobile-library__cell").nth(i).click();
    await expect(count).toHaveText(`${i + 1} Selected`);
    const state = await count.evaluate((el) => ({
      same: (el as HTMLElement & { __mark?: boolean }).__mark === true,
      anims: el.getAnimations().length,
    }));
    expect(state).toEqual({ same: true, anims: 0 });
  }
  await page.screenshot({ path: "e2e-shots-n510/510-selected-4.png", clip: { x: 0, y: 0, width: 390, height: 260 } });
});
