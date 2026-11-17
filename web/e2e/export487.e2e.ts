import { expect, test, type Page, type Route } from "@playwright/test";

// #487: the export flow with navigator.share / showDirectoryPicker stubbed.
// Screenshots of every state go to web/e2e-shots-487/ (not committed).
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-487";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

type Stubs = { share?: "ok" | "abort" | "none"; folder?: boolean };

// Installed after sign-in so the page's own code finds them when it asks.
async function stub(page: Page, { share = "ok", folder = false }: Stubs) {
  await page.evaluate(
    ({ share, folder }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__shared = [];
      w.__picked = [];
      const define = (key: string, value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true });
      if (share === "none") {
        define("share", undefined);
        define("canShare", undefined);
      } else {
        define("canShare", () => true);
        define("share", async (data: { files: File[] }) => {
          (w.__shared as unknown[]).push(data.files.map((f) => ({ name: f.name, size: f.size, type: f.type })));
          // A real sheet stays open until the user dismisses it.
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (share === "abort") throw new DOMException("dismissed", "AbortError");
        });
      }
      if (folder) {
        w.showDirectoryPicker = async () => ({
          name: "Photo Exports",
          getFileHandle: async (name: string, options?: { create?: boolean }) => {
            if (!options?.create) throw new DOMException("missing", "NotFoundError");
            (w.__picked as string[]).push(name);
            return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
          },
        });
      } else {
        delete w.showDirectoryPicker;
      }
    },
    { share, folder },
  );
}

const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: { name: string }[][] }).__shared);

async function selectTwo(page: Page, phone: boolean) {
  if (phone) {
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const cells = page.locator("img.mobile-library__cell");
    await cells.nth(0).click();
    await cells.nth(1).click();
  } else {
    const cells = page.locator("[data-asset-id]");
    await cells.nth(0).click();
    await cells.nth(1).click({ modifiers: ["ControlOrMeta"] });
  }
}

async function holdOriginals(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/libraries/*/original/**", async (route: Route) => {
    await gate;
    await route.continue();
  });
  return async () => {
    release();
  };
}

for (const scheme of ["light", "dark"] as const) {
  test(`export flow states (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "iphone and desktop only");
    const phone = info.project.name === "iphone";
    // Let the open animation finish so the dialog is opaque in the picture.
    const shot = async (name: string) => {
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${scheme}-${name}.png` });
    };
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await stub(page, { share: "ok", folder: !phone });
    await selectTwo(page, phone);
    const shareButton = phone ? page.getByRole("button", { name: "Share", exact: true }) : page.getByRole("button", { name: "Share", exact: true });
    const dialog = page.getByRole("dialog");
    // Presses inside a just-opened sheet are ignored for 500 ms (double-tap guard).
    const openDialog = async () => {
      await shareButton.click();
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(650);
    };

    // 1. choice (Originals), with count and size
    await openDialog();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("export-summary")).toContainText(/2 items · about/);
    await shot("1-choice");
    // 2. Cancel is silent
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await shared(page)).toEqual([]);

    // 3. fetching with progress (held), then 4. ready
    const release = await holdOriginals(page);
    await openDialog();
    await dialog.getByRole("radio", { name: /Compatible JPEG/ }).check();
    await shot("2-choice-jpeg");
    await dialog.getByRole("button", { name: /Share…/ }).click();
    await expect(dialog.getByRole("progressbar")).toBeVisible();
    await shot("3-fetching");
    await release();
    const confirm = dialog.getByRole("button", { name: "Share 2 items" });
    await expect(confirm).toBeVisible();
    expect(await shared(page)).toEqual([]);
    await shot("4-ready");

    // 5. dismissing the sheet is silent; the second tap shares once only
    await stub(page, { share: "abort", folder: !phone });
    await confirm.dblclick();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect((await shared(page)).length).toBe(1);
    await page.waitForTimeout(900); // the stubbed sheet dismisses itself
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await stub(page, { share: "ok", folder: !phone });
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    // stub() resets the log: only the confirmed share is in it.
    const calls = await shared(page);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0].every((file) => /\.(jpg|jpeg|mov|heic|png)$/i.test(file.name))).toBe(true);

    // 6. too large for the share sheet (summary says 900 MB)
    await page.route("**/selection-summary", (route) =>
      route.fulfill({ json: { count: 2, photos: 2, videos: 0, total_bytes: 900 * 1024 * 1024, date_first: null, date_last: null, place: null } }),
    );
    await openDialog();
    await expect(dialog.getByRole("note")).toContainText(/too large/);
    await expect(dialog.getByRole("button", { name: /Share…/ })).toBeDisabled();
    await shot("5-too-large");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.unroute("**/selection-summary");

    // 7. network failure
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("**/api/libraries/*/original/**", (route) => route.abort("failed"));
    await openDialog();
    await dialog.getByRole("button", { name: /Share…/ }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await shot("6-error");
    await dialog.getByRole("button", { name: "Try Again" }).click();
    await expect(dialog.getByRole("radio", { name: /Originals/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // 8. no Web Share: folder (desktop) or individual downloads
    await stub(page, { share: "none", folder: !phone });
    await shareButton.isVisible().then(async (visible) => {
      if (visible) await openDialog();
      else await page.getByRole("button", { name: "Download", exact: true }).click();
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Share…/ })).toHaveCount(0);
    await shot("7-choice-no-share");
    if (!phone) {
      await dialog.getByRole("button", { name: /Save to Folder…/ }).click();
      await expect(dialog.getByText(/Saved 2 files to “Photo Exports”/)).toBeVisible();
      await shot("8-folder-done");
      await dialog.getByRole("button", { name: "Done" }).click();
    } else {
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await dialog.getByRole("button", { name: /Download Individually/ }).click();
      await expect(dialog.getByRole("button", { name: "Done" })).toBeVisible({ timeout: 15000 });
      await shot("8-individual-done");
      expect(downloads.length).toBe(2);
      await dialog.getByRole("button", { name: "Done" }).click();
    }
    await expect(dialog).toHaveCount(0);
    // The page itself never left the app.
    expect(new URL(page.url()).pathname).not.toMatch(/original|blob/);
  });
}

test("Download as ZIP setting: More tab (phone) and user menu (desktop)", async ({ page }, info) => {
  test.skip(info.project.name === "small", "iphone and desktop only");
  const phone = info.project.name === "iphone";
  await signIn(page);
  await page.evaluate(() => localStorage.removeItem("photos-viewer:download-as-zip"));
  if (phone) {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
    const toggle = page.getByRole("switch", { name: "Download as ZIP" });
    await expect(toggle).not.toBeChecked();
    await toggle.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-setting-off.png` });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-setting-on.png` });
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    const item = page.getByRole("menuitemcheckbox", { name: "Download as ZIP" });
    await expect(item).toHaveAttribute("aria-checked", "false");
    await item.click();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Download as ZIP" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-setting-on.png` });
    await page.keyboard.press("Escape");
  }
  // On: two items download as one ZIP, no dialog.
  if (phone) await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Library" }).click();
  await selectTwo(page, phone);
  await stub(page, { share: "ok" });
  const zipRequest = page.waitForRequest((request) => request.url().includes("/zip"));
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await zipRequest;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("photos-viewer:download-as-zip"));
});

test("phone layout: rapid Share taps open one dialog and one share sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "phone layout");
  await signIn(page);
  await stub(page, { share: "ok" });
  await selectTwo(page, true);
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.waitForTimeout(700); // past the double-tap guard
  await page.getByRole("button", { name: /Share…/ }).click();
  const confirm = page.getByRole("button", { name: "Share 2 items" });
  await confirm.dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await shared(page)).toHaveLength(1);
});
