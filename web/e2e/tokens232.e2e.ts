import { type Page, expect, test } from "@playwright/test";

// #232: tokens resolve to the measured values; screenshots in light and dark.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots/p232";

async function login(page: Page, who: { username: string; password: string }, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

// Resolve a token through a probe element so colours come back normalised.
const resolved = (page: Page, name: string, prop: "backgroundColor" | "backdropFilter") =>
  page.evaluate(
    ([n, p]) => {
      const el = document.createElement("div");
      el.style.setProperty(p === "backgroundColor" ? "background-color" : "backdrop-filter", `var(${n})`);
      document.body.append(el);
      const v = getComputedStyle(el)[p as "backgroundColor"];
      el.remove();
      return v;
    },
    [name, prop],
  );

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} desktop`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("tokens, grid, viewer, settings", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, USER);
      expect(await resolved(page, "--blur-bar", "backdropFilter")).toBe("blur(20px)");
      expect(await resolved(page, "--color-sidebar-selected", "backgroundColor")).toBe(
        scheme === "dark" ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.08)",
      );
      await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      const cell = page.locator('[data-testid="library-cell"]').nth(3);
      await expect(cell).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-grid.png` });
      await page.locator("aside.sidebar").screenshot({ path: `${SHOTS}/desktop-${scheme}-sidebar.png` });
      await cell.dblclick();
      await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-viewer.png` });
    });

    test("admin settings", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop layout only");
      await login(page, ADMIN, "/admin");
      await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/desktop-${scheme}-settings.png` });
    });
  });

  test.describe(`${scheme} iphone`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("grid and bar", async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "phone layout only");
      await login(page, USER);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-grid.png` });
    });
  });
}
