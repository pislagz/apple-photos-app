import { type Page, expect, test } from "@playwright/test";

// #225: the Search screen (recents, suggestions, tokens, results) on both
// layouts, light and dark, against the demo server (scripts/dev_demo.py).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("pv.recentSearches")) {
      localStorage.setItem("pv.recentSearches", JSON.stringify(["Beach", "Dog at the park", "2024"]));
    }
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`search screen, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("empty, typing, token, results", async ({ page }, info) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(e.message));
      const mobile = info.project.name === "iphone";
      const shot = (name: string) =>
        page.screenshot({ path: `e2e/screenshots/225-${info.project.name}-${scheme}-${name}.png` });
      await signIn(page);
      if (mobile) await page.getByRole("button", { name: "Search", exact: true }).click();
      const field = page.getByRole("searchbox", { name: "Search photos" });

      // Empty: recent searches.
      if (mobile) {
        await field.blur();
        await expect(page.getByRole("heading", { name: "Recent Searches" })).toBeVisible();
        const card = page.locator(".recent-card").first();
        const box = await card.boundingBox();
        expect(Math.round(box?.width ?? 0)).toBe(128);
        const fieldBox = await page.locator(".search-box").boundingBox();
        expect(fieldBox?.height).toBeGreaterThanOrEqual(44);
        expect(fieldBox?.height).toBeLessThanOrEqual(54);
      } else {
        await field.focus();
        await expect(page.getByText("Recent Searches")).toBeVisible();
        const widened = await page.locator(".search-box").evaluate((el) => el.getBoundingClientRect().width);
        await page.waitForTimeout(300);
        expect(await page.locator(".search-box").evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(widened);
      }
      await shot("empty");

      // Typing: suggestions, and the free-text row first.
      await field.focus();
      await field.fill("20");
      await expect(page.getByRole("option").first()).toContainText("Search for");
      const rows = page.getByRole("option");
      await expect(rows).not.toHaveCount(1);
      const rowBox = await rows.first().boundingBox();
      expect(Math.round(rowBox?.height ?? 0)).toBe(46);
      await shot("typing");

      // Choosing a suggestion makes a token; results follow.
      await rows.nth(1).click();
      await expect(page.locator(".token")).toHaveCount(1);
      await expect(page.locator('img[src*="/thumb/"]').first()).toBeVisible();
      if (!mobile) await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
      if (!mobile) await expect(page.locator(".toolbar__count")).toContainText("item");
      await field.blur();
      await page.waitForFunction(
        () => [...document.querySelectorAll<HTMLImageElement>('img[src*="/thumb/"]')].filter((i) => i.naturalWidth > 0).length >= 3,
      );
      await shot("results");

      // The token comes off again.
      await page.getByRole("button", { name: /^Remove / }).click();
      await expect(page.locator(".token")).toHaveCount(0);

      // A search with no matches says so.
      await field.fill("zzzz");
      await field.press("Enter");
      await expect(page.getByText(/No results for .zzzz./)).toBeVisible();
      await shot("no-results");

      // Recents are stored on this device only.
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pv.recentSearches") ?? "[]"));
      expect(stored[0]).toBe("zzzz");
      expect(stored.length).toBeLessThanOrEqual(8);
      expect(problems).toEqual([]);
    });
  });
}
