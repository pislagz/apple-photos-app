import { expect, test, type Page, type Route } from "@playwright/test";

// #507: iPhone = Share only with an iOS-style HUD; Mac = Share + Download with a
// ▾ menu. navigator.share / showDirectoryPicker are stubbed; originals can be held
// to look at the HUD. Screenshots go to web/e2e-shots-g507/ (not committed).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-g507";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

type Stubs = { share?: "ok" | "abort" | "none"; folder?: boolean; expired?: boolean };

// Installed after sign-in so the page's own code finds them when it asks.
async function stub(page: Page, { share = "ok", folder = false, expired = false }: Stubs = {}) {
  await page.evaluate(
    ({ share, folder, expired }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__shared = [];
      const define = (key: string, value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true });
      if (share === "none") {
        define("share", undefined);
        define("canShare", undefined);
      } else {
        define("canShare", () => true);
        define("userActivation", expired ? { isActive: false, hasBeenActive: true } : { isActive: true, hasBeenActive: true });
        define("share", async (data: { files: File[] }) => {
          (w.__shared as unknown[]).push(data.files.map((f) => ({ name: f.name, size: f.size, type: f.type })));
          if (share === "abort") throw new DOMException("dismissed", "AbortError");
        });
      }
      if (folder) {
        w.showDirectoryPicker = async () => ({
          name: "Photo Exports",
          getFileHandle: async (_name: string, options?: { create?: boolean }) => {
            if (!options?.create) throw new DOMException("missing", "NotFoundError");
            return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
          },
        });
      } else {
        delete w.showDirectoryPicker;
      }
    },
    { share, folder, expired },
  );
}

const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: { name: string }[][] }).__shared);

// Records whether a HUD was ever in the DOM, so "no HUD flash" can be asserted.
async function watchHud(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __hudSeen: string | false };
    w.__hudSeen = false;
    new MutationObserver(() => {
      const found = document.querySelector('[data-testid="transfer-hud"]');
      if (found) w.__hudSeen = found.getAttribute("data-phase") ?? "yes";
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const hudSeen = (page: Page) => page.evaluate(() => (window as unknown as { __hudSeen: boolean }).__hudSeen);

async function selectPhotos(page: Page, phone: boolean, count: number) {
  if (phone) {
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const cells = page.locator("img.mobile-library__cell");
    for (let i = 0; i < count; i++) await cells.nth(i).click();
  } else {
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    const cells = page.locator("[data-asset-id]");
    await cells.nth(0).click();
    for (let i = 1; i < count; i++) await cells.nth(i).click({ modifiers: ["ControlOrMeta"] });
  }
}

async function holdOriginals(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/libraries/*/original/**", async (route: Route) => {
    await gate;
    await route.continue();
  });
  return () => release();
}

const hud = (page: Page) => page.getByTestId("transfer-hud");
const settle = (page: Page) => page.waitForTimeout(450); // HUD open animation

test.describe("iPhone: Share only", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "iphone", "iphone layout");
  });

  test("select bar has Share and no Download; HUD while preparing; one tap when ready", async ({ page }) => {
    await signIn(page);
    await stub(page);
    await selectPhotos(page, true, 2);
    const bar = page.getByTestId("select-bar");
    await expect(bar).toContainText(/2 .* Selected/);
    await expect(bar.getByRole("button", { name: /Download/ })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "HEIC as JPEG" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/iphone-light-1-select-bar.png` });

    const release = await holdOriginals(page);
    await bar.getByRole("button", { name: "Share", exact: true }).click();
    await expect(hud(page)).toBeVisible();
    await expect(hud(page).getByRole("progressbar")).toBeVisible();
    await expect(hud(page)).toContainText("Preparing 2 Items…");
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/iphone-light-2-hud-preparing.png` });
    await release();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    expect((await shared(page))[0]).toHaveLength(2);
    await expect(hud(page)).toHaveCount(0);
  });

  test("HUD preparing in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(page);
    await stub(page);
    await selectPhotos(page, true, 3);
    const release = await holdOriginals(page);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect(hud(page)).toContainText("Preparing 3 Items…");
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/iphone-dark-hud-preparing.png` });
    await hud(page).getByRole("button", { name: "Cancel" }).click();
    await expect(hud(page)).toHaveCount(0);
    await release();
    await page.waitForTimeout(300);
    expect(await shared(page)).toEqual([]);
  });

  test("expired tap: the HUD becomes one 'Share 3 Items' button", async ({ page }) => {
    await signIn(page);
    await stub(page, { expired: true });
    await selectPhotos(page, true, 3);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    const confirm = hud(page).getByRole("button", { name: "Share 3 Items" });
    await expect(confirm).toBeVisible();
    expect(await shared(page)).toEqual([]);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/iphone-light-3-share-n-items.png` });
    await confirm.dblclick();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    expect((await shared(page))[0]).toHaveLength(3);
    await expect(hud(page)).toHaveCount(0);
  });

  test("one fast item is one tap with no HUD flash", async ({ page }) => {
    await signIn(page);
    await stub(page);
    // The stored file (no JPEG conversion) comes back well inside the HUD delay.
    await page.evaluate(() => localStorage.setItem("photos-viewer:transfer-format", "original"));
    await watchHud(page);
    await selectPhotos(page, true, 1);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    expect(await hudSeen(page)).toBe(false);
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
  });

  test("More > Transfer Format: Automatic is JPEG, Keep Originals is the stored file", async ({ page }) => {
    await signIn(page);
    await stub(page);
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
    const group = page.getByRole("radiogroup", { name: "Transfer Format" });
    await expect(group.getByRole("radio", { name: "Automatic" })).toHaveAttribute("aria-checked", "true");
    await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${SHOTS}/iphone-light-4-more-transfer-format.png` });
    await expect(page.getByRole("switch", { name: "Download as ZIP" })).toHaveCount(0);

    const urls: string[] = [];
    page.on("request", (request) => request.url().includes("/original/") && urls.push(request.url()));
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Library" }).click();
    await selectPhotos(page, true, 1);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    const automatic = urls.length;
    expect(automatic).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
    await page.getByRole("radio", { name: "Keep Originals" }).click();
    await expect(page.getByRole("radio", { name: "Keep Originals" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Library" }).click();
    await selectPhotos(page, true, 1);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(() => urls.length).toBeGreaterThan(automatic);
    expect(urls.slice(automatic).every((url) => !url.includes("format=jpeg"))).toBe(true);
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
  });

  test("over the limit offers Save as ZIP to Files", async ({ page }) => {
    await signIn(page);
    await stub(page);
    // The format is read when Share is tapped, so no reload is needed.
    await page.evaluate(() => localStorage.setItem("photos-viewer:transfer-format", "original"));
    await page.route("**/selection-summary", (route) =>
      route.fulfill({ json: { count: 2, photos: 2, videos: 0, total_bytes: 900 * 1024 * 1024, date_first: null, date_last: null, place: null } }),
    );
    await selectPhotos(page, true, 2);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect(hud(page)).toContainText("Too Much to Share");
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/iphone-light-5-too-large.png` });
    const zip = page.waitForRequest((request) => request.url().includes("/zip/ticket"));
    await hud(page).getByRole("button", { name: "Save as ZIP to Files" }).click();
    await zip;
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
  });

  test("a failure shows Try Again in the HUD, which runs it again", async ({ page }) => {
    await signIn(page);
    await stub(page);
    await page.route("**/api/libraries/*/original/**", (route) => route.abort("failed"));
    await selectPhotos(page, true, 1);
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect(hud(page)).toContainText("Couldn't Share");
    await expect(hud(page).getByRole("button", { name: "Try Again" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/iphone-light-6-error.png` });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await hud(page).getByRole("button", { name: "Try Again" }).click();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
  });

  test("the viewer has Share and no Download", async ({ page }) => {
    await signIn(page);
    await stub(page);
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.route(/\/api\/libraries\/[^/]+\/assets\/[^/?]+$/, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), has_edited: true } });
    });
    await page.locator("img.mobile-library__cell").nth(0).click();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/iphone-light-7-viewer.png` });
  });
});

test.describe("Mac: Share + Download ▾", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout");
  });

  test("Download is one click: 2+ items are one ZIP; ▾ holds Unmodified Original and Export to Folder…", async ({ page }) => {
    await signIn(page);
    await stub(page, { folder: true });
    await selectPhotos(page, false, 2);
    const toolbar = page.locator(".desktop-library__bar-right");
    await expect(toolbar.getByRole("button", { name: "Share", exact: true })).toBeEnabled();

    await toolbar.getByRole("button", { name: "More Download Options" }).click();
    const menu = page.getByRole("menu", { name: "Download options" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Download Unmodified Original", "Export to Folder…"]);
    await page.screenshot({ path: `${SHOTS}/mac-light-1-download-menu.png`, clip: { x: 700, y: 0, width: 740, height: 200 } });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    const zip = page.waitForRequest((request) => request.url().includes("/zip"));
    await toolbar.getByRole("button", { name: "Download", exact: true }).click();
    await zip;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("without showDirectoryPicker the ▾ menu has no Export to Folder…", async ({ page }) => {
    await signIn(page);
    await stub(page, { folder: false });
    await selectPhotos(page, false, 2);
    await page.locator(".desktop-library__bar-right").getByRole("button", { name: "More Download Options" }).click();
    await expect(page.getByRole("menu", { name: "Download options" }).getByRole("menuitem")).toHaveText(["Download Unmodified Original"]);
  });

  test("Export to Folder… saves the files and says where", async ({ page }) => {
    await signIn(page);
    await stub(page, { folder: true });
    await selectPhotos(page, false, 2);
    await page.locator(".desktop-library__bar-right").getByRole("button", { name: "More Download Options" }).click();
    await page.getByRole("menuitem", { name: "Export to Folder…" }).click();
    await expect(hud(page)).toContainText("2 files saved to “Photo Exports”");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${SHOTS}/mac-light-4-export-done.png` });
    await hud(page).getByRole("button", { name: "OK" }).click();
    await expect(hud(page)).toHaveCount(0);
  });

  test("viewer: one Download button with ▾ (edited photo), plus Share and Copy Link", async ({ page }) => {
    await signIn(page);
    await stub(page, { folder: true });
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.route(/\/api\/libraries\/[^/]+\/assets\/[^/?]+$/, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), has_edited: true } });
    });
    await page.locator("[data-asset-id]").nth(3).dblclick();
    const viewer = page.getByTestId("desktop-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Show Original" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Download", exact: true })).toHaveCount(1);
    await expect(viewer.getByRole("button", { name: "Download Original" })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Copy Link" })).toBeVisible();
    await viewer.getByRole("button", { name: "More Download Options" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Download Unmodified Original", "Export to Folder…"]);
    await page.screenshot({ path: `${SHOTS}/mac-light-2-viewer-toolbar.png`, clip: { x: 640, y: 0, width: 800, height: 220 } });
  });

  test("context menu offers the same set as the viewer", async ({ page }) => {
    await signIn(page);
    await stub(page, { folder: false });
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.locator("[data-asset-id]").nth(2).dispatchEvent("contextmenu", { clientX: 600, clientY: 300, bubbles: true });
    await expect(page.getByTestId("context-menu").getByRole("menuitem")).toHaveText([
      "Share…",
      "Download",
      "Download Unmodified Original",
      "Copy Link",
    ]);
  });

  test("account menu: Transfer Format", async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Transfer Format" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Automatic" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("menuitemradio", { name: "Keep Originals" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "Download as ZIP" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/mac-light-3-account-transfer-format.png`, clip: { x: 0, y: 500, width: 520, height: 400 } });
    await page.getByRole("menuitemradio", { name: "Keep Originals" }).click();
    expect(await page.evaluate(() => localStorage.getItem("photos-viewer:transfer-format"))).toBe("original");
    await page.evaluate(() => localStorage.removeItem("photos-viewer:transfer-format"));
  });
});
