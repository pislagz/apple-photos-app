import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IconGallery from "../src/shell/IconGallery";
import { ICON_NAMES, Icon } from "../src/shell/icons";

// Dev-only logins printed by scripts/dev_demo.py for the synthetic demo library.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const USER = { username: "demo-user", password: "demo-user-pass-1" };

const SHOTS = process.env.SHOTS_DIR ?? "e2e/screenshots";

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
  // Unnamed clusters are listed after the named people, as Person A, B, ...
  await expect(page.getByRole("button", { name: /Person A/ })).toHaveCount(1);
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

async function setConsent(page: Page, consent: boolean, pmtilesPath: string | null = null) {
  const current = await (await page.request.get("/api/admin/settings")).json();
  const response = await page.request.put("/api/admin/settings", {
    data: { ...current, osm_consent: consent, map_tiles_pmtiles_path: pmtilesPath },
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
  await expect(cells(page).first()).toBeVisible();
  const viewer = page.locator('[data-testid="desktop-viewer"], [data-testid="mobile-viewer"]');
  // The demo photos have coordinates and no saved place; find one (some have no GPS).
  let found = false;
  for (let index = 0; index < 8 && !found; index++) {
    const cell = cells(page).nth(index);
    if (info.project.name === "desktop") await cell.dblclick();
    else await cell.tap();
    await expect(viewer).toBeVisible();
    await viewer.getByRole("button", { name: "Info" }).click();
    const panel = page.locator('[data-testid="viewer-info-panel"], [data-testid="viewer-info-sheet"]');
    await expect(panel).toBeVisible();
    await page.waitForTimeout(400);
    if ((await panel.innerText()).includes("°")) {
      found = true;
      const title = page.locator(".desktop-viewer__title-primary, .mobile-viewer__title-primary").first();
      // A date, never the coordinates (they are in the Location row below).
      await expect(title).not.toContainText("°");
      await expect(title).toContainText(/\d{4}/);
      await shot(page, "15-viewer-title-no-place", info.project.name);
    } else {
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);
    }
  }
  expect(found, "a demo photo with GPS and no place name").toBe(true);
});

test("D41: offline place name reads City, Country", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setConsent(page, true);
  // The demo's cities15000.txt is a four-row stand-in; the backfill runs in
  // the background, so the loop below retries. Then browse as the member.
  // The page's CSP must allow the tile host before the member's page loads.
  await expect
    .poll(async () => (await page.request.get("/")).headers()["content-security-policy"] ?? "")
    .toContain("tile.openstreetmap.org");
  await page.context().clearCookies();
  await signIn(page);
  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  const viewer = page.locator('[data-testid="desktop-viewer"], [data-testid="mobile-viewer"]');
  let found = false;
  for (let attempt = 0; attempt < 6 && !found; attempt++) {
    for (let index = 0; index < 8 && !found; index++) {
      const cell = cells(page).nth(index);
      if (info.project.name === "desktop") await cell.dblclick();
      else await cell.tap();
      await expect(viewer).toBeVisible();
      await viewer.getByRole("button", { name: "Info" }).click();
      const panel = page.locator('[data-testid="viewer-info-panel"], [data-testid="viewer-info-sheet"]');
      await expect(panel).toBeVisible();
      await page.waitForTimeout(400);
      if (/(France|United States|Japan|Australia)/.test(await panel.innerText())) {
        found = true;
        expect(await panel.innerText()).not.toMatch(/, (FR|US|JP|AU)\b/);
        await shot(page, "21-offline-place-name", info.project.name);
      } else {
        await page.keyboard.press("Escape");
        await expect(viewer).toHaveCount(0);
      }
    }
    if (!found) await page.waitForTimeout(1500); // backfill still running
  }
  expect(found, "a demo photo with an offline 'City, Country' place name").toBe(true);
  await page.context().clearCookies();
  await signIn(page, ADMIN);
  await setConsent(page, false);
});

test("D41: the Map view explains that the OpenStreetMap map is off", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setConsent(page, false);
  await page.reload();
  if (info.project.name === "desktop") {
    await page.locator("aside.sidebar").getByRole("button", { name: "Map" }).click();
  } else {
    await page.goto("/places");
  }
  await expect(page.getByTestId("map-off-note")).toContainText("Map & place names");
  await page.waitForLoadState("networkidle");
  await shot(page, "16-map-off-note", info.project.name);
});

test("Decisions 5: Settings has one Map & place names consent, off by default", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setConsent(page, false);
  await page.goto("/admin#map-place-names");
  const section = page.getByTestId("map-place-names");
  await expect(section).toBeVisible();
  await expect(section.getByLabel("Allow")).not.toBeChecked();
  await expect(section).toContainText("Nothing about your photos is sent.");
  await expect(section.getByLabel(/Local map file/)).toBeVisible();
  await expect(page.getByTestId("geonames-attribution")).toContainText("GeoNames");
  await section.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await shot(page, "17-settings-map-place-names", info.project.name);
});

test("Decisions 5: first-run setup asks the Map & place names question", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  // The demo already has an admin; pretend it has not, only to draw the screen.
  await page.route("**/api/setup/status", (route) => route.fulfill({ json: { needs_setup: true } }));
  await page.goto("/");
  const group = page.getByRole("group", { name: "Map & place names" });
  await expect(group).toBeVisible();
  await expect(group.getByLabel("Allow")).not.toBeChecked();
  await expect(group).toContainText("This app works fully offline.");
  await group.scrollIntoViewIfNeeded();
  await shot(page, "18-setup-map-place-names", info.project.name);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const who of ["user", "admin"] as const) {
  test(`Decisions 5: Info shows coordinates and an i icon with its tooltip until consent is given (${who})`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iPhone only");
    // Consent off, and the admin can see the library (the demo assigns it to the user only).
    const adminContext = await page.context().browser()!.newContext({ baseURL: info.project.use.baseURL ?? process.env.DEMO_URL ?? "http://127.0.0.1:8000" });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/");
    await adminPage.getByLabel("Username").fill(ADMIN.username);
    await adminPage.getByLabel("Password").fill(ADMIN.password);
    await adminPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(adminPage.getByLabel("Username")).toHaveCount(0);
    await setConsent(adminPage, false);
    if (who === "admin") {
      const users = await (await adminPage.request.get("/api/admin/users")).json();
      const libraries = await (await adminPage.request.get("/api/admin/libraries")).json();
      const admin = users.find((u: { username: string }) => u.username === ADMIN.username);
      await adminPage.request.put(`/api/admin/users/${admin.id}/libraries/${libraries[0].id}`);
    }
    await adminContext.close();

    await signIn(page, who === "admin" ? ADMIN : USER);
    await openZoom(page, "All Photos");
    await expect(cells(page).first()).toBeVisible();
    const viewer = page.locator('[data-testid="desktop-viewer"], [data-testid="mobile-viewer"]');
    let found = false;
    for (let index = 0; index < 8 && !found; index++) {
      const cell = cells(page).nth(index);
      if (info.project.name === "desktop") await cell.dblclick();
      else await cell.tap();
      await expect(viewer).toBeVisible();
      await viewer.getByRole("button", { name: "Info" }).click();
      const panel = page.locator('[data-testid="viewer-info-panel"], [data-testid="viewer-info-sheet"]');
      await expect(panel).toBeVisible();
      await page.waitForTimeout(400);
      if ((await panel.innerText()).includes("°")) {
        found = true;
        const hint = panel.getByRole("button", { name: "Why is there no place name?" });
        await expect(hint).toBeVisible();
        if (info.project.name === "desktop") await hint.hover();
        else await hint.tap();
        const tip = panel.getByRole("tooltip");
        await expect(tip).toBeVisible();
        await expect(tip).toContainText("Place names are off because you haven't agreed to use OpenStreetMap data.");
        if (who === "admin") {
          await expect(tip.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin#map-place-names");
        } else {
          await expect(tip).toContainText("An admin can change this in Settings.");
          await expect(tip.getByRole("link")).toHaveCount(0);
        }
        await page.waitForTimeout(300);
        await shot(page, `19-info-coordinates-hint-${who}`, info.project.name);
      } else {
        await page.keyboard.press("Escape");
        await expect(viewer).toHaveCount(0);
      }
    }
    expect(found, "a demo photo with GPS and no place name").toBe(true);
  });
}

// The demo content width where the lead photo used to jump (1600) and its neighbours.
for (const content of [1500, 1600, 1700]) {
  test(`Decisions 5: Days lead photo at ${content}px content width`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await signIn(page);
    await page.setViewportSize({ width: content + 200, height: 900 });
    await openZoom(page, "Days");
    await page.waitForTimeout(400);
    // Aim at the content width: the sidebar and padding take the rest.
    const measured = (await page.locator(".desktop-library__grid").first().boundingBox())!.width;
    await page.setViewportSize({ width: Math.round(content + 200 + (content - measured)), height: 900 });
    await page.waitForTimeout(400);
    const grid = (await page.locator(".desktop-library__grid").first().boundingBox())!.width;
    expect(Math.abs(grid - content), `content width ${grid}`).toBeLessThanOrEqual(2);
    const lead = (await cells(page).first().boundingBox())!;
    expect(lead.width / lead.height).toBeLessThanOrEqual(2.05);
    expect(lead.width).toBeLessThanOrEqual(grid);
    console.log(`content ${grid}px: lead ${lead.width}x${lead.height}`);
    await shot(page, `20-days-lead-${content}`, info.project.name);
  });
}

// ---- Decisions 5, fix run 2 ------------------------------------------------

// The demo admin already answered the question at setup, so the "not answered
// yet" state is drawn by serving that one status response as undecided.
const UNDECIDED = {
  dataset: "cities15000",
  downloaded: false,
  size_bytes: 0,
  source_url: "https://download.geonames.org/export/dump/cities15000.zip",
  attribution: "Place names from GeoNames (https://www.geonames.org), CC BY 4.0.",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  consent_decided: false,
  consent: false,
};

async function mockUndecided(page: Page) {
  await page.route("**/api/admin/place-names", (route) => route.fulfill({ json: UNDECIDED }));
}

test("Decisions 5: the notice offers Allow and Not now", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await mockUndecided(page);
  await page.goto("/admin");
  const notice = page.getByTestId("opt-in-notice");
  await expect(notice.getByRole("button", { name: "Allow" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Not now" })).toBeVisible();
  await shot(page, "22-notice-allow-not-now", info.project.name);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Decisions 5: Not now hides the notice and records the answer", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await mockUndecided(page);
  await page.route("**/api/admin/place-names/consent", (route) =>
    route.fulfill({ json: { ...UNDECIDED, consent_decided: true } }),
  );
  await page.goto("/admin");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/admin/place-names/consent"));
  await page.getByRole("button", { name: "Not now" }).click();
  expect((await request).postDataJSON()).toEqual({ agree: false });
  await expect(page.getByTestId("opt-in-notice")).toHaveCount(0);
  await expect(page.getByTestId("place-names-progress")).toHaveCount(0);
  await shot(page, "23-notice-not-now", info.project.name);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Decisions 5: Allow starts the place-name download and shows its progress", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await mockUndecided(page);
  await page.route("**/api/admin/place-names/consent", (route) =>
    route.fulfill({ json: { ...UNDECIDED, consent_decided: true, consent: true } }),
  );
  // The real download would reach geonames.org, which a sandbox cannot; hold it open for the shot.
  let finish: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (finish = resolve));
  await page.route("**/api/admin/place-names/download", async (route) => {
    await held;
    await route.fulfill({ json: { ...UNDECIDED, consent_decided: true, consent: true, downloaded: true, size_bytes: 2048 } });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Allow" }).click();
  const progress = page.getByTestId("place-names-progress");
  await expect(progress).toContainText("Downloading place-name data");
  await expect(page.getByTestId("opt-in-notice")).toHaveCount(0);
  // The download is held open on purpose, so the page is never "network idle".
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-24-notice-allow-downloading.png` });
  finish();
  await expect(progress).toContainText("downloaded");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function openMap(page: Page, project: string) {
  if (project === "desktop") await page.locator("aside.sidebar").getByRole("button", { name: "Map" }).click();
  else await page.goto("/places");
  await expect(page.locator(".map-pin").first()).toBeVisible();
  await page.waitForTimeout(1500); // let the basemap's first requests start and finish
  await page.waitForLoadState("networkidle");
}

const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4ce8sAAUVAoRiN5nPAAAAAElFTkSuQmCC",
  "base64",
);

test("Decisions 5: the map with consent uses OpenStreetMap tiles, even with a local file set", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  const file = join(mkdtempSync(join(tmpdir(), "pm-")), "stub.pmtiles");
  writeFileSync(file, Buffer.concat([Buffer.from("PMTiles"), Buffer.alloc(200)]));
  const osmRequests: string[] = [];
  const archiveRequests: string[] = [];
  // The sandbox has no internet; stand in for the tile server (a flat grey tile).
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    osmRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG });
  });
  page.on("request", (r) => {
    if (r.url().endsWith("/api/map/tiles.pmtiles")) archiveRequests.push(r.url());
  });
  await signIn(page, ADMIN);
  await setConsent(page, true, file);
  await expect
    .poll(async () => (await page.request.get("/")).headers()["content-security-policy"] ?? "")
    .toContain("tile.openstreetmap.org");
  await page.context().clearCookies();
  await signIn(page);
  await openMap(page, info.project.name);
  expect(osmRequests.length).toBeGreaterThan(0);
  expect(archiveRequests).toEqual([]);
  await expect(page.getByRole("link", { name: /OpenStreetMap contributors/ })).toBeVisible();
  await shot(page, "25-map-with-consent", info.project.name);
  await page.context().clearCookies();
  await signIn(page, ADMIN);
  await setConsent(page, false);
});

test("Decisions 5: the map without consent reads the local file and never calls OpenStreetMap", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  const file = join(mkdtempSync(join(tmpdir(), "pm-")), "stub.pmtiles");
  writeFileSync(file, Buffer.concat([Buffer.from("PMTiles"), Buffer.alloc(200)]));
  const osmRequests: string[] = [];
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    osmRequests.push(route.request().url());
    return route.abort();
  });
  const archive = page.waitForRequest((r) => r.url().endsWith("/api/map/tiles.pmtiles"));
  await signIn(page, ADMIN);
  await setConsent(page, false, file);
  await expect
    .poll(async () => (await page.request.get("/")).headers()["content-security-policy"] ?? "")
    .not.toContain("tile.openstreetmap.org");
  await page.context().clearCookies();
  await signIn(page);
  await openMap(page, info.project.name);
  expect((await archive).headers()["range"]).toMatch(/^bytes=/);
  expect(osmRequests).toEqual([]);
  await expect(page.getByTestId("map-off-note")).toHaveCount(0);
  await shot(page, "26-map-without-consent-local-file", info.project.name);
  await page.context().clearCookies();
  await signIn(page, ADMIN);
  await setConsent(page, false);
});

test("Decisions 5: the map without consent and no file is off", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page, ADMIN);
  await setConsent(page, false);
  await page.context().clearCookies();
  await signIn(page);
  await openMap(page, info.project.name);
  await expect(page.getByTestId("map-off-note")).toBeVisible();
  await shot(page, "27-map-without-consent-off", info.project.name);
});

// The app has no dark sidebar theme yet ("dark mode is a follow-up" in shell.css),
// so emulating prefers-color-scheme: dark leaves it light. For the dark proof we
// paint the sidebar's surface and text variables dark; the icon and chevron rules
// under test are the app's own.
async function darkenSidebar(page: Page) {
  // CSSOM only: the app's CSP forbids injected <style> elements.
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, `
      aside.sidebar { background: #232325 !important; }
      .sidebar__item, .sidebar__item[aria-current="page"] { color: #f5f5f7; }
      .sidebar__item[aria-current="page"] { background: rgba(255,255,255,0.14); }
      .sidebar__group > summary, .sidebar__note { color: #98989d; }
      :root { --sequoia-text-secondary: #98989d; }`);
}

// --- Icon set (#235): before/after proof shots ---

test.describe("icon set shots (#235)", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test(`sidebar selected rows (${scheme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        await signIn(page);
        await expect(page.locator("aside.sidebar")).toBeVisible();
        await page.locator("aside.sidebar").getByRole("button", { name: "Favorites", exact: true }).click();
        if (scheme === "dark") await darkenSidebar(page);
        await page.waitForLoadState("networkidle");
        await page.locator("aside.sidebar").screenshot({ path: `${SHOTS}/icons-sidebar-${scheme}.png` });
      });

      test(`livephoto and link, before | after (${scheme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        const dark = scheme === "dark";
        const svg = (size: number, body: string) =>
          `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
        // Round 2: twelve short dashes. Kept here only for the before | after proof.
        const dashes = (count: number, half: number) => {
          let d = "";
          for (let i = 0; i < count; i++) {
            const a = (i / count) * 2 * Math.PI;
            const t = half / 8.5;
            const p = (ang: number) => `${(10 + 8.5 * Math.sin(ang)).toFixed(2)} ${(10 - 8.5 * Math.cos(ang)).toFixed(2)}`;
            d += `M${p(a - t)}A8.5 8.5 0 0 1 ${p(a + t)}`;
          }
          return d;
        };
        const OLD: Record<string, string> = {
          livephoto: `<circle cx="10" cy="10" r="1.9" fill="currentColor"/><circle cx="10" cy="10" r="5"/><path d="${dashes(12, 0.45)}"/>`,
          link: `<path d="M8.4 11.6a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M11.6 8.4a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l.9-.9"/>`,
        };
        const rows = (["livephoto", "link"] as const)
          .map((name) => {
            const cell = (size: number) =>
              `<span class="c">${svg(size, OLD[name])}</span><span class="c">${renderToStaticMarkup(createElement(Icon, { name, size }))}</span>`;
            return `<div class="r"><b>${name}</b><div class="g"><i>before</i><i>after</i>${cell(120)}</div><div class="g"><i>20 px</i><i></i>${cell(20)}</div><div class="g"><i>16 px</i><i></i>${cell(16)}</div></div>`;
          })
          .join("");
        await page.setContent(
          `<style>
            body { margin: 0; padding: 24px; font: 13px system-ui; background: ${dark ? "#1c1c1e" : "#fff"}; color: ${dark ? "#f5f5f7" : "#1d1d1f"}; }
            .r { display: flex; align-items: flex-end; gap: 36px; margin-bottom: 28px; }
            .r b { width: 80px; }
            .g { display: grid; grid-template-columns: 140px 140px; gap: 6px; align-items: center; }
            .g i { color: ${dark ? "#98989d" : "#6e6e73"}; font-style: normal; }
            .c { display: flex; align-items: center; color: #0a84ff; }
          </style>${rows}`,
        );
        await page.setViewportSize({ width: 1000, height: 420 });
        await page.screenshot({ path: `${SHOTS}/icons2-before-after-${scheme}.png`, fullPage: true });
      });

      test(`sidebar nested folders (${scheme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        await signIn(page);
        const side = page.locator("aside.sidebar");
        await expect(side.getByText("Europe")).toBeVisible();
        if (scheme === "dark") await darkenSidebar(page);
        await page.waitForLoadState("networkidle");
        await side.screenshot({ path: `${SHOTS}/icons2-sidebar-folders-open-${scheme}.png` });
        // Collapse Family; keep Trips > Europe open.
        await side.getByText("Family", { exact: true }).click();
        await expect(side.getByRole("button", { name: "Birthdays" })).toBeHidden();
        await side.locator("summary", { hasText: "Family" }).focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await side.screenshot({ path: `${SHOTS}/icons2-sidebar-folders-collapsed-${scheme}.png` });
        await side.getByText("Family", { exact: true }).click();
      });

      test.describe("zoomed", () => {
        test.use({ deviceScaleFactor: 2 });
        // 4x device pixels so the 16 px and 20 px renderings can be inspected.
        test(`livephoto 16/20 px before | after, outline and filled, 4x (${scheme})`, async ({ page }, info) => {
          test.skip(info.project.name !== "desktop", "desktop only");
          const dark = scheme === "dark";
          const dashes = (count: number, half: number) => {
            let d = "";
            for (let i = 0; i < count; i++) {
              const a = (i / count) * 2 * Math.PI;
              const t = half / 8.5;
              const q = (ang: number) => `${(10 + 8.5 * Math.sin(ang)).toFixed(2)} ${(10 - 8.5 * Math.cos(ang)).toFixed(2)}`;
              d += `M${q(a - t)}A8.5 8.5 0 0 1 ${q(a + t)}`;
            }
            return d;
          };
          const oldSvg = (size: number, filled: boolean) =>
            `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${
              filled
                ? `<circle cx="10" cy="10" r="5.75" fill="currentColor"/><circle cx="10" cy="10" r="1.9" fill="${dark ? "#1c1c1e" : "#fff"}" stroke="none"/>`
                : `<circle cx="10" cy="10" r="1.9" fill="currentColor"/><circle cx="10" cy="10" r="5"/>`
            }<path d="${dashes(12, 0.45)}"/></svg>`;
          const cells = (size: number) =>
            [false, true]
              .map(
                (filled) =>
                  `<span class="c">${oldSvg(size, filled)}</span><span class="c">${renderToStaticMarkup(createElement(Icon, { name: "livephoto", size, filled }))}</span>`,
              )
              .join("");
          await page.setContent(
            `<style>
              body { margin: 0; padding: 16px; font: 12px system-ui; background: ${dark ? "#1c1c1e" : "#fff"}; color: ${dark ? "#f5f5f7" : "#1d1d1f"}; }
              .g { display: grid; grid-template-columns: 60px repeat(4, 56px); gap: 10px; align-items: center; margin-bottom: 12px; }
              .c { color: #0a84ff; display: flex; justify-content: center; }
              i { font-style: normal; color: ${dark ? "#98989d" : "#6e6e73"}; text-align: center; }
            </style>
            <div class="g"><i></i><i>old</i><i>new</i><i>old filled</i><i>new filled</i></div>
            <div class="g"><b>16 px</b>${cells(16)}</div>
            <div class="g"><b>20 px</b>${cells(20)}</div>`,
          );
          await page.setViewportSize({ width: 380, height: 120 });
          await page.screenshot({ path: `${SHOTS}/icons3-livephoto-16-20-${scheme}.png`, scale: "device" });
        });

        test(`sidebar section vs folder arrows, 2x (${scheme})`, async ({ page }, info) => {
          test.skip(info.project.name !== "desktop", "desktop only");
          await signIn(page);
          const side = page.locator("aside.sidebar");
          await expect(side.getByText("Europe")).toBeVisible();
          if (scheme === "dark") await darkenSidebar(page);
          await page.waitForLoadState("networkidle");
          await side.getByText("Family", { exact: true }).click();
          await expect(side.getByRole("button", { name: "Birthdays" })).toBeHidden();
          await side.screenshot({ path: `${SHOTS}/icons3-sidebar-2x-${scheme}.png` });
          await side.getByText("Family", { exact: true }).click();
        });
      });

      test(`icon gallery (${scheme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        const markup = renderToStaticMarkup(createElement(IconGallery));
        const dark = scheme === "dark";
        await page.setContent(
          `<style>
            body { margin: 0; padding: 24px; font: 13px system-ui; background: ${dark ? "#1c1c1e" : "#fff"}; color: ${dark ? "#f5f5f7" : "#1d1d1f"}; }
            .icon-gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 32px; }
            .icon-gallery__row { display: flex; align-items: center; gap: 14px; padding: 4px 0; border-bottom: 1px solid ${dark ? "#38383a" : "#e5e5ea"}; }
            .icon-gallery__name { width: 84px; color: ${dark ? "#98989d" : "#6e6e73"}; }
            svg { flex: none; color: #0a84ff; }
          </style><h3 style="margin:0 0 12px">Icons: 20 px outline, 20 px filled, 40 px outline, 40 px filled</h3>${markup}`,
        );
        await page.setViewportSize({ width: 1440, height: 760 });
        await page.screenshot({ path: `${SHOTS}/icons-gallery-${scheme}.png`, fullPage: true });
      });

      test(`size ladder 16/18/20 beside text (${scheme})`, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "desktop only");
        const dark = scheme === "dark";
        const names = ICON_NAMES.filter((name) => name !== "chevron");
        const rows = [16, 18, 20]
          .map((size) => {
            const icons = names
              .map((name) => renderToStaticMarkup(createElement(Icon, { name, size, filled: false })))
              .join("");
            const solid = names
              .map((name) => renderToStaticMarkup(createElement(Icon, { name, size, filled: true })))
              .join("");
            return `<div class="r"><b>${size}px</b><span>${icons}</span></div><div class="r"><b>filled</b><span>${solid}</span></div>`;
          })
          .join("");
        await page.setContent(
          `<style>
            body { margin: 0; padding: 20px; font: 13px system-ui; background: ${dark ? "#1c1c1e" : "#fff"}; color: ${dark ? "#f5f5f7" : "#1d1d1f"}; }
            .r { display: flex; align-items: center; gap: 12px; margin: 4px 0; }
            .r b { width: 52px; font-weight: 500; }
            .r span { display: flex; gap: 10px; align-items: center; }
            svg { color: #0a84ff; }
          </style>${rows}<p style="display:flex;align-items:center;gap:8px">${renderToStaticMarkup(createElement(Icon, { name: "library", size: 18, filled: true }))} Library &nbsp; ${renderToStaticMarkup(createElement(Icon, { name: "favorite", size: 18 }))} Favorites &nbsp; ${renderToStaticMarkup(createElement(Icon, { name: "map", size: 18 }))} Map</p>`,
        );
        await page.setViewportSize({ width: 1100, height: 400 });
        await page.screenshot({ path: `${SHOTS}/icons-sizes-${scheme}.png`, fullPage: true });
      });
    });
  }

  test("iPhone tab bar", async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone only");
    await signIn(page);
    await expect(page.locator("nav.tab-bar")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.locator("nav.tab-bar").screenshot({ path: `${SHOTS}/icons-tabbar-library.png` });
    await page.getByRole("button", { name: "Albums" }).click();
    await page.waitForLoadState("networkidle");
    await page.locator("nav.tab-bar").screenshot({ path: `${SHOTS}/icons-tabbar-albums.png` });
  });

  test("viewer toolbar and Info panel (desktop)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await signIn(page);
    await openZoom(page, "All Photos");
    await expect(cells(page).first()).toBeVisible();
    await page.getByRole("button", { name: "Info" }).click();
    await cells(page).first().click();
    await expect(page.getByTestId("library-info-panel")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOTS}/icons-info-panel.png` });
    await page.getByTestId("desktop-library-toolbar").screenshot({ path: `${SHOTS}/icons-library-toolbar.png` });
    await cells(page).first().dblclick();
    await expect(page.getByRole("button", { name: /close/i }).first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/icons-viewer-toolbar.png` });
  });

  test("viewer toolbar (iPhone)", async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone only");
    await signIn(page);
    await openZoom(page, "All Photos");
    await cells(page).first().tap();
    await expect(page.getByRole("button", { name: /close|back/i }).first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/icons-viewer-iphone.png` });
  });
});

// #89: a failed /assets request is an error with Retry, never "No photos yet."
test("library load error shows Retry (#89)", async ({ page }, info) => {
  let fail = true;
  // The injected 500 is logged by the browser as a console error; that is the point of the test.
  page.on("console", (message) => {
    if (/status of 500/.test(message.text())) consoleErrors = consoleErrors.filter((e) => e !== message.text());
  });
  await page.route(/\/api\/libraries\/\d+\/assets\?/, (route) =>
    fail ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
  );
  await signIn(page);
  await openZoom(page, "All Photos");
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't load" });
  await expect(alert).toBeVisible();
  await expect(page.getByText("No photos yet.")).toHaveCount(0);
  await shot(page, "14-library-load-error", info.project.name);
  fail = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(cells(page).first()).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("#78: the viewer says a referenced original is stored outside the library", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  // The demo library has no referenced originals; mark every asset as one.
  await page.route(/\/api\/libraries\/\d+\/assets\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, original_outside_library: true } });
  });
  await page.route(/\/api\/libraries\/\d+\/original\//, (route) =>
    route.fulfill({ status: 404, json: { detail: "original_not_available" } }),
  );
  await signIn(page);
  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  const viewer = page.locator('[data-testid="desktop-viewer"], [data-testid="mobile-viewer"]');
  if (info.project.name === "desktop") await cells(page).first().dblclick();
  else await cells(page).first().tap();
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId("original-outside-note")).toContainText("stored outside the library");
  await page.waitForTimeout(600);
  await shot(page, "16-original-outside-library", info.project.name);
});

// #218: the same screens in both appearances, for before/after comparison.
// THEME_SHOTS_PREFIX names the files (`before`, `after`); run with -g "theme shots".
for (const scheme of ["light", "dark"] as const) {
  test(`theme shots: ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iPhone only");
    const prefix = process.env.THEME_SHOTS_PREFIX ?? "after";
    const kind = info.project.name === "desktop" ? "desktop" : "phone";
    const out = (name: string) => `${SHOTS}/${prefix}-${scheme}-${kind}-${name}.png`;
    const snap = async (name: string) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(name) });
    };
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await snap("login");

    await signIn(page);
    await openZoom(page, "All Photos");
    await expect(cells(page).first()).toBeVisible();
    await snap("library");

    if (kind === "desktop") {
      await page.locator(".account-menu__row-trigger").click();
      await expect(page.locator(".account-menu__popover")).toBeVisible();
      await snap("menu");
      await page.locator(".account-menu__row-trigger").click();
    }

    const first = cells(page).first();
    if (kind === "desktop") await first.dblclick();
    else await first.tap();
    await expect(page.getByRole("button", { name: /close|back/i }).first()).toBeVisible();
    await snap("viewer");
  });
}

// #207: the desktop grid at every zoom stop, light and dark, plus the narrow and
// wide windows at the default zoom. With the edge-length stops (max 4) the last
// tile must end flush with the grid's right edge.
for (const scheme of ["light", "dark"] as const) {
  test(`desktop grid zoom stops and widths, ${scheme} (#207)`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await openZoom(page, "All Photos");
    await expect(cells(page).first()).toBeVisible();
    const slider = page.locator('input[type="range"][aria-label="Zoom"]');
    const setZoom = async (value: number) => {
      await slider.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, String(v));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await page.waitForTimeout(400);
    };
    const max = Number(await slider.getAttribute("max"));
    for (let stop = 0; stop <= max; stop++) {
      await setZoom(stop);
      if (max === 4) {
        const flush = await page.evaluate(() => {
          const grid = document.querySelector('[data-testid="desktop-library-grid"]') as HTMLElement;
          const right = grid.getBoundingClientRect().left + grid.clientWidth;
          const rows = [...grid.querySelectorAll(".desktop-library__row-grid")];
          const edges = rows.map((row) => Math.max(...[...row.children].map((c) => c.getBoundingClientRect().right)));
          return { right, maxEdge: Math.max(...edges) };
        });
        expect(Math.abs(flush.maxEdge - flush.right), `stop ${stop} right edge`).toBeLessThan(0.51);
      }
      await shot(page, `20-desktop-grid-${scheme}-zoom${stop}`, info.project.name);
    }
    await setZoom(2);
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(500);
      await shot(page, `21-desktop-grid-${scheme}-w${width}`, info.project.name);
    }
  });
}

// #209: the library date title at each level, both appearances. TITLE_SHOTS_PREFIX
// names the files (`before`, `after`); run with -g "title shots".
for (const scheme of ["light", "dark"] as const) {
  test(`title shots: ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iPhone only");
    const prefix = process.env.TITLE_SHOTS_PREFIX ?? "after";
    const kind = info.project.name === "desktop" ? "desktop" : "phone";
    const scroller = page.getByTestId(kind === "desktop" ? "desktop-library-grid" : "library-scroll");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    for (const [label, slug] of [
      ["Years", "years"],
      ["Months", "months"],
      ["All Photos", "all"],
    ] as const) {
      await openZoom(page, label);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/${prefix}-${scheme}-${kind}-${slug}.png` });
      if (kind === "desktop" || slug === "all") {
        // Scrolled: a header row or photos sit right under the title.
        await scroller.evaluate((el) => {
          el.scrollTop = 420;
        });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${SHOTS}/${prefix}-${scheme}-${kind}-${slug}-scrolled.png` });
        await scroller.evaluate((el) => {
          el.scrollTop = 0;
        });
      }
    }
  });
}

// #208 tile overlays and selection. Light and dark; desktop mixed selection
// (a video and a favourite), the densest zoom, and the iPhone grid and
// selection mode.
// The demo has no ffmpeg here, so its videos carry no duration; give them one
// in the list response so the duration overlay can be seen.
async function fakeVideoDurations(page: Page) {
  await page.route(/\/api\/libraries\/\d+\/assets\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const item of body.items ?? []) if (item.is_video) item.duration = 65 + (item.id.length % 7) * 11;
    await route.fulfill({ response, json: body });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tile overlays (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("desktop mixed selection and dense zoom (#208)", async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "desktop only");
      await fakeVideoDurations(page);
      await signIn(page);
      await openZoom(page, "All Photos");
      await expect(cells(page).first()).toBeVisible();
      await page.waitForTimeout(800);
      const tag = `208-${scheme}`;
      // The demo has a video every 53rd asset: scroll to the first one and
      // select it plus its neighbours (some of which are favourites).
      const video = page.locator('[data-testid="library-cell"]:has(.desktop-library__duration)').first();
      await video.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      const visible = page.locator('[data-testid="library-cell"]');
      const videoIndex = await visible.evaluateAll((els) => els.findIndex((el) => el.querySelector(".desktop-library__duration")));
      for (const offset of [-9, -1, 0, 2, 9]) {
        const cell = visible.nth(videoIndex + offset);
        if (await cell.count()) await cell.click({ modifiers: ["Control"] });
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await shot(page, `${tag}-desktop-selection`, info.project.name);
      await page.keyboard.press("Escape");

      await page.getByRole("slider", { name: "Zoom" }).fill("0");
      await page.waitForTimeout(800);
      await shot(page, `${tag}-desktop-dense`, info.project.name);
    });

    test("iPhone grid and selection mode (#208)", async ({ page }, info) => {
      test.skip(info.project.name !== "iphone", "iPhone only");
      await fakeVideoDurations(page);
      await signIn(page);
      await openZoom(page, "All Photos");
      await expect(cells(page).first()).toBeVisible();
      await page.waitForTimeout(800);
      await shot(page, `208-${scheme}-iphone-grid`, info.project.name);
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await cells(page).nth(0).click();
      await cells(page).nth(2).click();
      await cells(page).nth(3).click();
      await page.waitForTimeout(300);
      await shot(page, `208-${scheme}-iphone-selection`, info.project.name);
    });
  });
}

// #209: the title and scrim never take pointer events, so taps and rubber-band
// drags reach the tiles underneath, and no inline header overlaps the title.
test("date title and scrim are click-through, with no overlapping text (#209)", async ({ page }, info) => {
  test.skip(info.project.name === "small", "desktop and iPhone only");
  await signIn(page);
  await openZoom(page, "All Photos");
  await expect(cells(page).first()).toBeVisible();
  const desktop = info.project.name === "desktop";
  const title = page.getByTestId(desktop ? "desktop-library-title" : "pinned-header");
  await expect(title).toBeVisible();
  const tb = (await title.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? { cell: !!el.closest("[data-asset-id], .mobile-library__cell"), cls: el.className } : null;
    },
    [tb.x + 4, tb.y + 4],
  );
  expect(hit?.cell, `element under the title: ${hit?.cls}`).toBe(true);
  if (desktop) {
    // Tap through the scrim selects the tile under it.
    await page.mouse.click(tb.x + 40, tb.y + 4);
    await expect(page.locator('[data-testid="library-cell"][data-selected="true"]')).toHaveCount(1);
    // Months: scroll through the whole first screens; the title and a header never intersect.
    await openZoom(page, "Months");
    const grid = page.getByTestId("desktop-library-grid");
    for (let top = 0; top < 1800; top += 90) {
      await grid.evaluate((el, t) => {
        el.scrollTop = t;
      }, top);
      await page.waitForTimeout(220); // outlast the 150 ms fade
      const t = page.getByTestId("desktop-library-title");
      const visible = (await t.evaluate((el) => getComputedStyle(el.parentElement!).opacity)) !== "0";
      if (!visible) continue;
      const tbx = (await t.boundingBox())!;
      for (const h of await page.locator(".desktop-library__row-header").all()) {
        const hb = await h.boundingBox();
        if (!hb) continue;
        expect(hb.y >= tbx.y + tbx.height || hb.y + hb.height <= tbx.y, `header at ${hb.y} vs title at scroll ${top}`).toBe(true);
      }
    }
  }
});
