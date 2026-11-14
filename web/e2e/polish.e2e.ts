import { type Page, expect, test } from "@playwright/test";

// P3.4 acceptance against the demo server (scripts/dev_demo.py): layout at
// each project width (desktop, iphone 390, small 320: every test runs in all
// three except the desktop-only keyboard path), reduced motion, alt text.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

// Desktop opens on a zoom segment that has no photo cells; All Photos does.
async function openAllPhotos(page: Page) {
  if (await page.locator("aside.sidebar").count()) {
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  }
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"], .mobile-library__cell').first()).toBeVisible();
}

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

test("no horizontal overflow, content images have real alt text", async ({ page }, info) => {
  await signIn(page);
  expect(await noHorizontalOverflow(page)).toBe(true);
  const alts = await page.locator("main img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")));
  expect(alts.length).toBeGreaterThan(0);
  for (const alt of alts) {
    expect(alt, "alt is present").toBeTruthy();
    expect(alt, "alt is not a filename").not.toMatch(/\.(heic|jpe?g|png|mov|mp4)$/i);
  }
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-12-polish-layout.png` });
  await page.goto("/admin").catch(() => {});
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("one h1 and landmarks on the signed-in shell", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  expect(await page.locator("h1").count()).toBeGreaterThanOrEqual(1);
});

test.describe("desktop keyboard path", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "keyboard path is the desktop layout");
  });

  const ringVisible = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
        ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2,
      };
    });

  test("Tab reaches controls in order, each with a visible ring, and never traps", async ({ page }, info) => {
    await signIn(page);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const state = await ringVisible(page);
      if (!state) continue;
      expect(state.ring, `focus ring on "${state.label}"`).toBe(true);
      seen.push(state.label);
      if (i === 5) await page.screenshot({ path: `${SHOTS}/${info.project.name}-12-polish-focus-ring.png` });
    }
    // The sidebar toggle is the first stop, so the sidebar is reachable before the grid.
    expect(seen[0]).toBe("Hide sidebar");
    // Focus moves on every press (no trap) and visits many distinct controls.
    expect(new Set(seen).size).toBeGreaterThan(8);
  });

  test("grid -> viewer -> Escape returns to the grid; sidebar toggle skips the sidebar", async ({ page }, info) => {
    await signIn(page);
    await openAllPhotos(page);
    await page.getByTestId("library-cell").first().dblclick();
    const viewer = page.getByTestId("desktop-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("img").first()).toHaveAttribute("alt", /.+/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).toBeVisible();
    const toggle = page.getByRole("button", { name: "Hide sidebar" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Show sidebar" })).toBeFocused();
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(2);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-12-polish-sidebar-collapsed.png` });
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => document.activeElement?.closest("aside.sidebar") !== null);
    expect(next, "Tab does not enter the collapsed sidebar").toBe(false);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  });
});

test.describe("reduced motion", () => {
  test("motion on: viewer dismiss animates; reduced: it is instant and transitions are off", async ({ page }, info) => {
    await signIn(page);
    await openAllPhotos(page);
    const open = async () => {
      if (info.project.name === "desktop") await page.getByTestId("library-cell").first().dblclick();
      else await page.locator(".mobile-library__cell").first().tap();
    };
    const viewer = page.locator(".desktop-viewer, .mobile-viewer");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open();
    await expect(viewer).toBeVisible();
    await page.keyboard.press("Escape");
    // #220: closing zooms back into the tile (data-zoom), or plays the fade
    // (is-closing) when no tile is on screen; either way it is not instant.
    await expect
      .poll(() => viewer.evaluate((el) => el.getAttribute("data-zoom") === "1" || el.classList.contains("is-closing")))
      .toBe(true);
    // #286: the closing photo stays on its tile until the viewer unmounts, it
    // never snaps back to full screen over the grid. Sample every frame.
    const flashed = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const el = document.querySelector(".desktop-viewer, .mobile-viewer");
          let flash = false;
          const tick = () => {
            const root = document.querySelector(".desktop-viewer, .mobile-viewer");
            if (!root || root !== el) return resolve(flash);
            const stage = root.querySelector<HTMLElement>("[data-testid$='-stage']");
            if (root.getAttribute("data-zoom") !== "1" && !root.classList.contains("is-closing") && stage) flash = true;
            requestAnimationFrame(tick);
          };
          tick();
        }),
    );
    expect(flashed).toBe(false);
    await expect(viewer).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await open();
    await expect(viewer).toBeVisible();
    const duration = await viewer.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000)).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0, { timeout: 100 });
    if (info.project.name !== "desktop") {
      const tab = await page.locator(".tab-bar__item").first().evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(parseFloat(tab)).toBeLessThan(0.001);
    }
  });
});

// #178: the compact view switch is keyed to the Library container, not the
// viewport. Narrow only the container (the window stays at its project width).
test("compact view switch follows the container width, not the viewport", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "the segmented view switch is the phone layout");
  await signIn(page);
  const items = page.locator(".mobile-library__view-switch-item");
  await expect(items).toHaveCount(4);
  const fontSize = () => items.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const onOneLine = () =>
    items.evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size === 1);

  // Force a wide container first so the baseline does not depend on the project.
  const library = page.locator(".mobile-library");
  await library.evaluate((el) => {
    (el as HTMLElement).style.width = "390px";
  });
  const wide = await fontSize();
  expect(wide).toBeGreaterThan(12);

  await library.evaluate((el) => {
    (el as HTMLElement).style.width = "300px";
  });
  await expect.poll(fontSize).toBe(12);
  expect(await onOneLine()).toBe(true);
  expect(await page.evaluate(() => window.innerWidth)).toBe(info.project.name === "small" ? 320 : 390);
});

// F8: at <=1100px the expanded search takes toolbar space instead of covering the icons.
test("narrow desktop: expanded search never overlaps the toolbar buttons", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop toolbar only");
  await page.setViewportSize({ width: 1000, height: 800 });
  await signIn(page);
  await openAllPhotos(page);
  const input = page.locator(".search-box--desktop .search-box__input");
  await input.focus();
  await expect(input).toHaveCSS("width", "190px");
  const box = await input.boundingBox();
  const buttons = page.locator(".desktop-library__toolbar button:visible");
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const b = await buttons.nth(i).boundingBox();
    if (!b || b.width === 0) continue;
    expect(b.x + b.width, `button ${i} overlaps search`).toBeLessThanOrEqual(box!.x + 1);
  }
});

// F7: no dead Share button without Web Share (plain http / unsupported).
test("desktop: Share is hidden when navigator.share is unavailable", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop toolbar only");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await signIn(page);
  await openAllPhotos(page);
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
});

// #255: one cursor across a whole menu row -- padding, label and the gap to
// the next item -- so it never flickers between the hand and the arrow.
test("menu rows and toolbar buttons keep a single cursor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover cursors are a desktop concern");
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  const popover = page.locator(".account-menu__popover");
  await expect(popover).toBeVisible();
  // Points inside the control must all be the arrow. A rounded corner's point
  // can land on the bar behind it (`auto`, also drawn as the arrow); those
  // only must never be the hand.
  const cursorsAcross = async (selector: string) =>
    page.locator(selector).evaluateAll((elements) => {
      const seen = new Set<string>();
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        for (const fx of [0.02, 0.25, 0.5, 0.75, 0.98]) {
          for (const fy of [0.1, 0.5, 0.9]) {
            const hit = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
            if (!hit) continue;
            const cursor = getComputedStyle(hit).cursor;
            if (element.contains(hit)) seen.add(cursor);
            else if (cursor === "pointer") seen.add(`pointer outside ${element.className}`);
          }
        }
      }
      return [...seen];
    });
  expect(await cursorsAcross(".account-menu__popover :is(a, button)")).toEqual(["default"]);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(popover).toHaveCount(0);
  expect(await cursorsAcross(".toolbar-button, .sidebar__item")).toEqual(["default"]);
});

// #216: one bottom layer over the grid; the zoom pill sits right above the tab row.
test("iPhone bottom chrome is one bar and the last row clears it", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout");
  await signIn(page);
  const bar = page.locator("nav.tab-bar");
  await expect(bar).toHaveClass(/tab-bar--overlay/);
  expect(await bar.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  const pill = await page.locator(".mobile-library__view-switch").boundingBox();
  const barBox = await bar.boundingBox();
  expect(pill && barBox && pill.y + pill.height <= barBox.y + barBox.height).toBe(true);
  expect(pill && barBox && barBox.y - (pill.y + pill.height) < 16).toBe(true);
  const padding = await page
    .getByTestId("library-scroll")
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(120);
  await page.locator(".tab-bar__item", { hasText: "Albums" }).click();
  await expect(bar).not.toHaveClass(/tab-bar--overlay/);
});
