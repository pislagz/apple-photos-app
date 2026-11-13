import { type Page, expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// #223: Albums and People & Pets layouts against the demo server
// (scripts/dev_demo.py). Screenshots: e2e/screenshots/223-*.png.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function shot(page: Page, name: string, project: string, scheme: string) {
  mkdirSync("e2e/screenshots", { recursive: true });
  await page.screenshot({ path: `e2e/screenshots/223-${name}-${project}-${scheme}.png` });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`albums and people (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("albums and people layouts", async ({ page }, info) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(e.message));
      const project = info.project.name;
      const desktop = project === "desktop";
      await signIn(page);

      if (desktop) {
        await page.locator(".sidebar__item", { hasText: "Albums" }).first().click();
        const grid = page.locator(".albums-overview__grid");
        await expect(grid.locator(".album-tile").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const tiles = await grid.locator(".album-tile").evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect()),
        );
        expect(tiles.length).toBeGreaterThan(1);
        expect(tiles[0].width).toBeGreaterThanOrEqual(170);
        expect(tiles[1].left - tiles[0].right).toBeCloseTo(18, 0);
        const cover = await grid.locator(".album-cover").first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height, radius: getComputedStyle(el).borderTopLeftRadius };
        });
        expect(Math.abs(cover.w - cover.h)).toBeLessThan(1);
        expect(cover.radius).toBe("8px");
        await shot(page, "albums", project, scheme);

        await grid.locator(".album-tile").first().click();
        await expect(page.locator(".toolbar .toolbar-button", { hasText: "Albums" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "album-open", project, scheme);
        await page.keyboard.press("Control+[");
        await expect(page.locator(".albums-overview__grid")).toBeVisible();

        await page.locator(".sidebar__item", { hasText: "People & Pets" }).click();
        const face = page.locator(".people-grid__face").first();
        await expect(face).toBeVisible();
        await page.waitForLoadState("networkidle");
        const box = await face.boundingBox();
        expect(Math.round(box!.width)).toBe(110);
        await face.hover();
        await page.waitForTimeout(250);
        await shot(page, "people", project, scheme);
      } else {
        await page.goto("/albums");
        await expect(page.locator(".album-card").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const heading = page.locator(".albums-home__heading").first();
        expect(await heading.evaluate((el) => getComputedStyle(el).fontSize)).toBe("22px");
        const card = page.locator(".album-card").first();
        expect(await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("22px");
        const faceBox = await page.locator(".albums-home__row--people .people-grid__face").first().boundingBox();
        expect(Math.round(faceBox!.width)).toBe(76);
        for (const target of await page.locator(".albums-home button").all()) {
          const b = await target.boundingBox();
          if (b) expect(b.height).toBeGreaterThanOrEqual(43.5);
        }
        await shot(page, "albums", project, scheme);
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(300);
        await shot(page, "albums-scrolled", project, scheme);

        await page.goto("/people");
        await expect(page.locator(".people-grid__item").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot(page, "people", project, scheme);
      }
      expect(problems).toEqual([]);
    });
  });
}
