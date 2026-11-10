import { type Page, expect, test } from "@playwright/test";

// Dev-only logins printed by scripts/dev_demo.py for the synthetic demo library.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const USER = { username: "demo-user", password: "demo-user-pass-1" };

const SHOTS = "e2e/screenshots";

let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The signed-out probe of /api/auth/me is a 401 the app expects.
    if (/status of 401/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
});

test.afterEach(() => {
  expect(consoleErrors, "console errors").toEqual([]);
});

async function shot(page: Page, name: string, projectName: string) {
  // Let thumbnails settle so the picture shows images, not blanks.
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/${projectName}-${name}.png` });
}

async function signIn(page: Page, who = USER) {
  await page.goto("/");
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

const cells = (page: Page) => page.locator('[data-testid="library-cell"], .mobile-library__cell');

async function openZoom(page: Page, label: string) {
  // Desktop has no Days segment: Days is its own sidebar section (#127).
  if (label === "Days" && (await page.locator("aside.sidebar").count()) > 0) {
    await page.locator("aside.sidebar").getByRole("button", { name: "Days", exact: true }).click();
    await expect(page.locator("aside.sidebar").getByRole("button", { name: "Days", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    return;
  }
  if (await page.locator("aside.sidebar").count()) {
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  }
  await page.getByRole("tab", { name: label, exact: true }).click();
  await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
}

test("login screen", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await shot(page, "01-login", info.project.name);
});

test("library zoom levels", async ({ page }, info) => {
  await signIn(page);
  await expect(page.getByRole("tab", { name: "Years", exact: true })).toBeVisible();

  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  expect(await cells(page).count()).toBeGreaterThan(0);
  await shot(page, "02-library-all", info.project.name);

  if (info.project.name === "small") return;

  for (const [label, name] of [
    ["Years", "03-library-years"],
    ["Months", "04-library-months"],
    ["Days", "05-library-days"],
  ] as const) {
    await openZoom(page, label);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, name, info.project.name);
  }
});

test("small phone library", async ({ page }, info) => {
  test.skip(info.project.name !== "small", "320x568 only");
  await signIn(page);
  for (const [label, name] of [
    ["Years", "03-library-years"],
    ["Months", "04-library-months"],
    ["Days", "05-library-days"],
  ] as const) {
    await openZoom(page, label);
    await page.waitForTimeout(500);
    await shot(page, name, info.project.name);
  }
});

test("phone view switch fits the viewport", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone only");
  await signIn(page);
  await openZoom(page, "Years");
  const tabs = page.getByRole("tablist", { name: "Library zoom" });
  await expect(tabs).toBeVisible();
  const vw = page.viewportSize()!.width;
  const box = (await tabs.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  for (const tab of await tabs.getByRole("tab").all()) {
    const b = (await tab.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
});

test("viewer opens on a photo", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  await openZoom(page, "All Photos");
  const first = cells(page).first();
  await expect(first).toBeVisible();
  if (info.project.name === "desktop") await first.dblclick();
  else await first.tap();
  await expect(page.getByRole("button", { name: /close|back/i }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "06-viewer", info.project.name);
});

test("sidebar (desktop)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await expect(page.locator("aside.sidebar")).toBeVisible();
  await shot(page, "07-sidebar", info.project.name);
});

test("albums: folder tree and an album's photos", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "Favorites Trip" }).click();
    await expect(page.getByRole("heading", { name: "Favorites Trip" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Albums" }).click();
    await page.getByRole("button", { name: /Trips/ }).click();
    await page.getByRole("button", { name: /Europe/ }).click();
    await shot(page, "10-albums-folder", info.project.name);
    await page.getByRole("button", { name: /Favorites Trip/ }).click();
    await expect(page.getByRole("heading", { name: "Favorites Trip" })).toBeVisible();
  }
  await expect(cells(page).first()).toBeVisible();
  await shot(page, "11-album", info.project.name);
});

test("people: faces grid and a person's photos", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "People & Pets" }).click();
  } else {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /People & Pets/ }).click();
  }
  await expect(page.getByRole("button", { name: /Alex Demo/ })).toBeVisible();
  // The unnamed cluster is listed after the named people, with a placeholder.
  await expect(page.getByRole("button", { name: /Add Name/ })).toHaveCount(1);
  await shot(page, "12-people", info.project.name);
  await page.getByRole("button", { name: /Alex Demo/ }).click();
  await expect(page.getByRole("heading", { name: "Alex Demo" })).toBeVisible();
  await expect(cells(page).first()).toBeVisible();
  await shot(page, "13-person", info.project.name);
});

test("hidden asks for the password again", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "Hidden" }).click();
  } else {
    await page.getByRole("link", { name: "More" }).or(page.getByRole("button", { name: "More" })).first().click();
    await page.getByRole("button", { name: /Hidden/ }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Hidden is locked" });
  await expect(dialog).toBeVisible();
  await shot(page, "08-hidden-locked", info.project.name);

  await dialog.getByLabel("Password").fill("wrong-password-1");
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Incorrect password");

  await dialog.getByLabel("Password").fill(USER.password);
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hidden" })).toBeVisible();
  await shot(page, "09-hidden-unlocked", info.project.name);
});

test("admin panel", async ({ page }, info) => {
  await signIn(page, ADMIN);
  await page.goto("/admin");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "10-admin", info.project.name);

  // #158: styled, and no page-level horizontal overflow on any screen.
  await expect(page.locator(".admin-app")).toHaveCSS("display", "grid");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  for (const [i, label] of ["Libraries", "Users", "Access", "Sessions", "Audit log", "Settings"].entries()) {
    await nav.getByRole("button", { name: label }).click();
    await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${label} overflows horizontally`).toBeLessThanOrEqual(innerWidth);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-10-admin-${i + 1}-${label.toLowerCase().replace(" ", "-")}.png` });
  }
});

test("phone title never overlaps Select or the account button (#159)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone widths only");
  await signIn(page);
  const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const label of ["All Photos", "Years", "Months", "Days"]) {
    await openZoom(page, label);
    await page.waitForTimeout(300);
    const select = page.getByRole("button", { name: "Select", exact: true });
    const title = page.getByTestId("pinned-header");
    const account = page.locator(".account-menu__trigger");
    const sb = (await select.count()) ? await select.boundingBox() : null;
    const tb = (await title.count()) ? await title.boundingBox() : null;
    const ab = await account.boundingBox();
    if (sb && tb) expect(intersects(tb, sb), `${label}: title vs Select`).toBe(false);
    if (tb && ab) expect(intersects(tb, ab), `${label}: title vs account`).toBe(false);
    if (sb && ab) expect(intersects(sb, ab), `${label}: Select vs account`).toBe(false);
    if (sb) expect(sb.x + sb.width, `${label}: Select inside viewport`).toBeLessThanOrEqual(info.project.use.viewport!.width);
  }
});

test("desktop Days lead photo: narrow rule, 960 cap, scaled cap on wide windows (#153, #170)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  for (const [width, height] of [
    [1000, 800], // content under 960px: full width, two thumbnail rows tall
    [1440, 900], // 960 cap
    [1920, 1080], // content >= 1600px: four columns' worth, still 2:1
    [2560, 1300],
  ]) {
    await page.setViewportSize({ width, height });
    await openZoom(page, "Days");
    await page.waitForTimeout(400);
    const content = await page.locator(".desktop-library__grid").first().boundingBox();
    const box = await cells(page).first().boundingBox();
    expect(box, `${width}: lead photo`).not.toBeNull();
    const contentWidth = content!.width;
    if (contentWidth < 960) {
      expect(box!.width, `${width}: narrow lead is full width`).toBeGreaterThan(contentWidth - 24);
    } else if (contentWidth < 1600) {
      expect(box!.width, `${width}: lead width`).toBeLessThanOrEqual(960);
      expect(box!.width / box!.height, `${width}: lead aspect`).toBeLessThanOrEqual(2.05);
    } else {
      expect(box!.width, `${width}: scaled lead is at least the cap`).toBeGreaterThanOrEqual(960);
      expect(box!.width, `${width}: scaled lead fits`).toBeLessThanOrEqual(contentWidth);
      expect(box!.width / box!.height, `${width}: lead aspect`).toBeLessThanOrEqual(2.05);
    }
    // Resizing must re-measure rows: the next row starts below the lead photo.
    const next = await cells(page).nth(1).boundingBox();
    if (next) expect(next.y, `${width}: next row below lead`).toBeGreaterThanOrEqual(box!.y + box!.height);
  }
});

// #88: unit tests run with a faked layout; this checks the real thing. The
// library scroll container must be bounded by the viewport (not grow with its
// content), and virtualization must mount far fewer cells than exist.
test("phone library scroll container is viewport-bounded and virtualized (#88)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone widths only");
  await signIn(page);
  await openZoom(page, "All Photos");
  await page.waitForTimeout(500);
  const scroll = page.locator(".mobile-library__scroll");
  const { clientHeight, scrollHeight, innerHeight } = await scroll.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(clientHeight, "scroll container fits the viewport").toBeLessThanOrEqual(innerHeight);
  expect(scrollHeight, "content overflows inside it").toBeGreaterThan(clientHeight);
  const mounted = await page.locator(".mobile-library__cell").count();
  expect(mounted, "cells are virtualized").toBeGreaterThan(0);
  expect(mounted, "far fewer cells than photos").toBeLessThan(120);
});

test("phone Days view has a scrim behind Select (#176)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone only");
  await signIn(page);
  await openZoom(page, "Days");
  await expect(cells(page).first()).toBeVisible();
  await expect(page.getByTestId("top-bar")).toHaveAttribute("data-scrim", "true");
  const bg = await page.getByTestId("top-bar").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("linear-gradient");
  await shot(page, "11-days-scrim", info.project.name);
});

test("admin Users actions are compact on a phone (#179)", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone only");
  await signIn(page, ADMIN);
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
  const actions = page.locator(".admin-actions").first();
  await expect(actions).toBeVisible();
  const tops = await actions.locator("button").evaluateAll((buttons) =>
    Array.from(new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))),
  );
  expect(tops.length, "four buttons sit in two rows, not a stack").toBe(2);
  const wrap = page.locator(".admin-table-wrap").first();
  const overflow = await wrap.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "the Users table does not scroll sideways").toBeLessThanOrEqual(0);
  await shot(page, "12-admin-users-actions", info.project.name);
});

// The demo library has no update history and keeps every original, so these
// three shots stub just the one response that carries the state (D4, D5).
test("library updated banner (D4)", async ({ page }, info) => {
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response }); // the signed-out probe
    const body = await response.json();
    body.libraries = body.libraries.map((library: object) => ({
      ...library,
      updated_note: { run_id: 99, added: 1204, removed: 3, finished_at: "2026-11-09T10:00:00Z" },
    }));
    await route.fulfill({ status: 200, json: body });
  });
  await page.route("**/updated-note/dismiss", (route) => route.fulfill({ json: { run_id: 99 } }));
  await signIn(page);
  const banner = page.getByTestId("library-updated-note");
  await expect(banner).toContainText("Library updated · +1,204 added, \u22123 removed");
  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  await shot(page, "13-library-updated-note", info.project.name);
  if (info.project.name !== "desktop") {
    // #159 rule: the banner never sits under the floating account button, and
    // the title/Select bar sits below it.
    const hit = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const close = await banner.getByRole("button", { name: "Dismiss library update note" }).boundingBox();
    const account = await page.locator(".account-menu__trigger").boundingBox();
    const bannerBox = await banner.boundingBox();
    const title = await page.getByTestId("pinned-header").boundingBox();
    const select = await page.getByRole("button", { name: "Select", exact: true }).boundingBox();
    expect(close && account && bannerBox).toBeTruthy();
    expect(hit(bannerBox!, account!), "banner vs account button").toBe(false);
    expect(hit(close!, account!), "close vs account button").toBe(false);
    if (title) expect(hit(bannerBox!, title), "banner vs title").toBe(false);
    if (select) expect(hit(bannerBox!, select), "banner vs Select").toBe(false);
  }
  await banner.getByRole("button", { name: "Dismiss library update note" }).click();
  await expect(banner).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("info note when only a smaller copy is on disk (D5)", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await page.route(/\/api\/libraries\/\d+\/assets\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ status: 200, json: { ...(await response.json()), original_available: false } });
  });
  await signIn(page);
  await openZoom(page, "All Photos");
  const first = cells(page).first();
  await expect(first).toBeVisible();
  if (info.project.name === "desktop") await first.dblclick();
  else await first.tap();
  await page.getByLabel("Info").click();
  await expect(page.getByTestId("original-missing-note")).toContainText("Only a smaller copy is on this Mac");
  await page.waitForTimeout(500);
  await shot(page, "14-info-original-missing", info.project.name);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("admin Settings: Manual only and Check now (D6)", async ({ page }, info) => {
  await signIn(page, ADMIN);
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const manual = page.getByLabel(/Manual only/);
  await manual.scrollIntoViewIfNeeded();
  await shot(page, "15-settings-interval", info.project.name);
  await manual.check();
  await expect(page.getByText(/only checked when you press "Check now"/)).toBeVisible();
  await page.getByRole("button", { name: "Check now" }).scrollIntoViewIfNeeded();
  await shot(page, "15-settings-manual-only", info.project.name);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(/Checking all libraries for changes now|already running/)).toBeVisible();
  // Not saved: leave the demo as we found it.
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("sidebar toggle hover is visible (#200)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await signIn(page);
    const toggle = page.getByRole("button", { name: "Hide sidebar" });
    await toggle.hover();
    await expect(toggle).toHaveCSS("background-color", "rgba(255, 255, 255, 0.14)");
    await shot(page, "13-dark-sidebar-toggle-hover", info.project.name);
  });
});

// ---- Decisions 3 --------------------------------------------------------

async function setMapMode(page: Page, mode: "online" | "local_file" | "off", offlineNames = false) {
  const current = await (await page.request.get("/api/admin/settings")).json();
  const response = await page.request.put("/api/admin/settings", {
    data: { ...current, map_tiles_mode: mode, map_tiles_pmtiles_path: null, offline_place_names: offlineNames },
  });
  expect(response.ok()).toBe(true);
}

test("D21: Info panel summarises a multi-selection", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await signIn(page);
  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  await page.getByRole("button", { name: "Info" }).click();
  await expect(page.getByTestId("library-info-panel")).toContainText("No Selection");
  const grid = page.getByTestId("desktop-library-grid");
  await cells(page).first().click();
  await cells(page).nth(2).click({ modifiers: ["Shift"] });
  const panel = page.getByTestId("library-info-panel");
  await expect(panel).toContainText("Selected");
  await expect(panel).toContainText(/\d+ photos?/);
  await expect(panel).toContainText("Size");
  await grid.focus();
  await page.waitForLoadState("networkidle");
  await shot(page, "14-info-multi-selection", info.project.name);
});

test("D41: the viewer title is the date for a photo with GPS but no place name", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  await openZoom(page, "All Photos");
  const first = cells(page).first();
  await expect(first).toBeVisible();
  if (info.project.name === "desktop") await first.dblclick();
  else await first.tap();
  const title = page.locator(".desktop-viewer__title-primary, .mobile-viewer__title-primary").first();
  await expect(title).toBeVisible();
  // The demo photos have coordinates and no saved place: the title is a date, never coordinates.
  await expect(title).not.toContainText("°");
  await page.getByRole("button", { name: "Info" }).first().click();
  await expect(page.locator('[data-testid="viewer-info-panel"], [data-testid="viewer-info-sheet"]')).toContainText("°");
  await page.waitForTimeout(500);
  await shot(page, "15-viewer-title-no-place", info.project.name);
});

test("D41: the Map view explains that the OpenStreetMap map is off", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setMapMode(page, "off");
  await page.reload();
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "Map" }).click();
  } else {
    await page.goto("/places");
  }
  await expect(page.getByTestId("map-off-note")).toContainText("Show OpenStreetMap map");
  await page.waitForLoadState("networkidle");
  await shot(page, "16-map-off-note", info.project.name);
});

test("D41: Settings has the two optional features, both off by default", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setMapMode(page, "off");
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Show OpenStreetMap map")).not.toBeChecked();
  await expect(page.getByLabel("Offline place names")).not.toBeChecked();
  await expect(page.getByTestId("geonames-attribution")).toContainText("GeoNames");
  await page.getByLabel("Show OpenStreetMap map").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await shot(page, "17-settings-optional-features", info.project.name);
});
