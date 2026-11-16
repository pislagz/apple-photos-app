import { type Page, expect, test } from "@playwright/test";

// #79: before/after screenshots of every phone screen (iPhone 390x844, light
// and dark), plus a handful of 1440px desktop screens that prove the phone
// restyle did not leak into the Sequoia layout. Not part of `npm test` or CI.
//   SHOT_PHASE=before|after  SHOT_DIR=/path  npx playwright test shots79
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const PHASE = process.env.SHOT_PHASE ?? "after";
const DIR = process.env.SHOT_DIR ?? "test-results/shots79";

type Scheme = "light" | "dark";

async function signIn(page: Page, who = USER, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function shot(page: Page, screen: string, scheme: Scheme) {
  await page.waitForLoadState("networkidle");
  // Enter animations (sheets, menus, cross-fades) have finished.
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${DIR}/${screen}-${scheme}-${PHASE}.png` });
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const cells = (page: Page) => page.locator(".mobile-library__cell");

async function openZoom(page: Page, label: string) {
  await page.getByRole("tab", { name: label, exact: true }).click();
  await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(400);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`phone ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test.beforeEach(({}, info) => {
      test.skip(info.project.name !== "iphone", "iPhone 390x844 only");
    });

    test("login", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await shot(page, "login", scheme);
      await page.getByLabel("Username").fill("someone");
      await page.getByLabel("Password").fill("wrong-password-1");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await shot(page, "login-error", scheme);
    });

    test("first-run setup", async ({ page }) => {
      await page.route("**/api/setup/status", (route) =>
        route.fulfill({ json: { needs_setup: true, keep_signed_in: true } }),
      );
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Create admin account" })).toBeVisible();
      await shot(page, "setup", scheme);
    });

    test("library: all, scrolled, years, months, days", async ({ page }) => {
      await signIn(page);
      await openZoom(page, "All Photos");
      await expect(cells(page).first()).toBeVisible();
      await shot(page, "library-all", scheme);
      await page.getByTestId("library-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
      await page.waitForTimeout(600);
      await shot(page, "library-all-scrolled", scheme);
      for (const label of ["Years", "Months", "Days"]) {
        await openZoom(page, label);
        await shot(page, `library-${label.toLowerCase()}`, scheme);
      }
    });

    test("library: filter menu and select mode", async ({ page }) => {
      await signIn(page);
      await openZoom(page, "All Photos");
      await expect(cells(page).first()).toBeVisible();
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      await expect(page.locator(".filter-menu__popup")).toBeVisible();
      await shot(page, "filter-menu", scheme);
      await page.getByTestId("filter-menu-backdrop").click();
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await shot(page, "select-empty", scheme);
      await cells(page).nth(1).tap();
      await cells(page).nth(2).tap();
      await cells(page).nth(5).tap();
      await shot(page, "select-three", scheme);
    });

    test("viewer and info sheet", async ({ page }) => {
      await signIn(page);
      await openZoom(page, "All Photos");
      await cells(page).nth(4).tap();
      await expect(page.getByTestId("mobile-viewer")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, "viewer", scheme);
      await page.getByRole("button", { name: "Info", exact: true }).click();
      await expect(page.getByTestId("viewer-info-sheet")).toBeVisible();
      await shot(page, "viewer-info", scheme);
    });

    test("albums: home, folder, album", async ({ page }) => {
      await signIn(page);
      await tabBar(page).getByRole("button", { name: "Albums" }).click();
      await expect(page.locator("main").getByRole("heading", { name: "Albums", level: 1 })).toBeVisible();
      await shot(page, "albums", scheme);
      await page.getByRole("button", { name: /Trips/ }).click();
      await shot(page, "albums-folder", scheme);
      await page.getByRole("button", { name: /Europe/ }).click();
      await page.getByRole("button", { name: /Favorites Trip/ }).click();
      await expect(page.getByRole("heading", { name: "Favorites Trip" })).toBeVisible();
      await expect(cells(page).first()).toBeVisible();
      await shot(page, "album-grid", scheme);
    });

    test("more: list, people, person, places, media type, hidden", async ({ page }) => {
      await signIn(page);
      await tabBar(page).getByRole("button", { name: "More" }).click();
      await expect(page.locator(".more-screen")).toBeVisible();
      await shot(page, "more", scheme);
      await page.locator(".more-screen__body").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await shot(page, "more-bottom", scheme);
      await page.locator(".more-screen__body").evaluate((el) => (el.scrollTop = 0));

      await page.getByRole("button", { name: /People & Pets/ }).click();
      await expect(page.getByRole("button", { name: /Alex Demo/ })).toBeVisible();
      await shot(page, "people", scheme);
      await page.getByRole("button", { name: /Alex Demo/ }).click();
      await expect(page.getByRole("heading", { name: "Alex Demo" })).toBeVisible();
      await expect(cells(page).first()).toBeVisible();
      await shot(page, "person", scheme);

      await tabBar(page).getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: "Places", exact: true }).click();
      await page.waitForTimeout(800);
      await shot(page, "places", scheme);

      await tabBar(page).getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: "Videos", exact: true }).click();
      await expect(cells(page).first()).toBeVisible();
      await shot(page, "media-type", scheme);

      await tabBar(page).getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: "Hidden", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Hidden is locked" })).toBeVisible();
      await shot(page, "hidden-locked", scheme);
    });

    test("more: account dialogs", async ({ page }) => {
      await signIn(page);
      await tabBar(page).getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "change-password", scheme);
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Passkeys", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "passkeys", scheme);
      await page.getByRole("dialog").getByRole("button", { name: /Done|Close/ }).first().click();
      await page.getByRole("button", { name: /Choose avatar/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "avatar-picker", scheme);
    });

    test("search: empty, suggestions, results", async ({ page }) => {
      await signIn(page);
      await tabBar(page).getByRole("button", { name: "Search" }).click();
      await expect(page.locator("main").getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
      await page.locator(".search-box__input").blur();
      await shot(page, "search", scheme);
      await page.locator(".search-box__input").fill("a");
      await page.waitForTimeout(500);
      await shot(page, "search-suggestions", scheme);
      await page.locator(".search-box__input").fill("Paris");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(800);
      await shot(page, "search-results", scheme);
    });

    test("empty library", async ({ page }) => {
      await page.route(/\/api\/libraries\/\d+\/(assets|summary)(\?.*)?$/, (route) => {
        const body = route.request().url().includes("/summary")
          ? { years: [], months: [], days: [] }
          : { items: [], next_cursor: null };
        return route.fulfill({ json: body });
      });
      await signIn(page);
      await expect(page.getByTestId("library-empty")).toBeVisible();
      await shot(page, "library-empty", scheme);
    });

    test("admin on the phone", async ({ page }) => {
      await signIn(page, ADMIN, "/admin");
      const nav = page.getByRole("navigation", { name: "Admin sections" });
      for (const label of ["Libraries", "People", "Sharing", "Devices", "Activity", "Settings"]) {
        await nav.getByRole("button", { name: label }).click();
        await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
        await shot(page, `admin-${label.toLowerCase()}`, scheme);
      }
      await page.locator(".admin-main").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        document.scrollingElement?.scrollTo(0, document.body.scrollHeight);
      });
      await shot(page, "admin-settings-bottom", scheme);
      await nav.getByRole("button", { name: "People" }).click();
      await page.getByRole("button", { name: /Add Person/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "admin-sheet", scheme);
      await page.keyboard.press("Escape");
      await nav.getByRole("button", { name: "Libraries" }).click();
      await page.getByText("Demo Library").first().click();
      await page.waitForTimeout(500);
      await shot(page, "admin-library-detail", scheme);
    });
  });

  test.describe(`desktop ${scheme} (must not change)`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    test.beforeEach(({}, info) => {
      test.skip(info.project.name !== "desktop", "1440px desktop only");
    });

    test("desktop screens", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await shot(page, "desktop-login", scheme);
      await signIn(page, ADMIN);
      const sidebar = page.locator("aside.sidebar");
      await sidebar.getByRole("button", { name: "Library" }).click();
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await expect(page.locator('[data-testid="library-cell"]').first()).toBeVisible();
      await shot(page, "desktop-library", scheme);
      await page.getByRole("tab", { name: "Years", exact: true }).click();
      await shot(page, "desktop-years", scheme);
      await page.getByRole("tab", { name: "All Photos", exact: true }).click();
      await page.getByRole("button", { name: "Filter By" }).click();
      await expect(page.locator(".filter-menu__popup")).toBeVisible();
      await shot(page, "desktop-filter-menu", scheme);
      await page.keyboard.press("Escape");
      await page.locator('[data-testid="library-cell"]').nth(2).dblclick();
      await expect(page.getByTestId("desktop-viewer")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, "desktop-viewer", scheme);
      await page.keyboard.press("Escape");
      await sidebar.getByRole("button", { name: "People & Pets" }).click();
      await shot(page, "desktop-people", scheme);
      await sidebar.getByRole("button", { name: "Hidden" }).click();
      await expect(page.getByRole("dialog", { name: "Hidden is locked" })).toBeVisible();
      await shot(page, "desktop-hidden-locked", scheme);
      await page.goto("/admin");
      const nav = page.getByRole("navigation", { name: "Admin sections" });
      for (const label of ["Libraries", "People", "Settings"]) {
        await nav.getByRole("button", { name: label }).click();
        await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
        await shot(page, `desktop-admin-${label.toLowerCase()}`, scheme);
      }
      await nav.getByRole("button", { name: "People" }).click();
      await page.getByRole("button", { name: /Add Person/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "desktop-admin-sheet", scheme);
    });
  });
}
