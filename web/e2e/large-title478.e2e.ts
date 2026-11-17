import { type Page, expect, test } from "@playwright/test";

// #478: More and Albums use an iOS Settings-style large title that scrolls away.
const SHOTS = "e2e-shots-478";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo-user");
  await page.getByLabel("Password").fill("demo-user-pass-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

for (const scheme of ["light", "dark"] as const) {
  for (const tab of ["Albums", "More"] as const) {
    test(`${tab} large title scrolls into a small bar (${scheme})`, async ({ page }, info) => {
      test.skip(info.project.name === "desktop", "iPhone layout only");
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page);
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: tab }).click();
      await expect(page.getByText(tab === "Albums" ? "Media Types" : "Utilities").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const bar = page.locator(".large-title-bar");
      const scroll = page.getByTestId("large-title-scroll");
      await page.waitForTimeout(500);
      const range = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight);
      // Like iOS: a screen that barely scrolls keeps its large title.
      test.skip(range < 60, `only ${range}px of scroll on this viewport`);
      await expect(bar).toHaveCSS("opacity", "0");
      await page.screenshot({ path: `${SHOTS}/${tab.toLowerCase()}-rest-${scheme}.png` });
      await scroll.evaluate((el) => {
        el.scrollTop = 120;
      });
      await expect(bar).toHaveCSS("opacity", "1");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${tab.toLowerCase()}-scrolled-${scheme}.png` });
    });
  }
}

test("Media Types rows match the More rows", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "iPhone layout only");
  await signIn(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Albums" }).click();
  const albumsRow = page.locator(".albums-home__types .more-screen__item").first();
  const h1 = await albumsRow.evaluate((el) => el.getBoundingClientRect().height);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  const moreRow = page.locator(".more-screen__item").first();
  expect(h1).toBe(await moreRow.evaluate((el) => el.getBoundingClientRect().height));
});
