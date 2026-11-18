import { expect, test, type Page } from "@playwright/test";

// #508: Share must reach navigator.share with real Files of the right MIME, and a
// failure must name its real cause. Only share/canShare are stubbed (minimally);
// fetch is real against the demo server. Shots go to web/e2e-shots-n501/.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e-shots-n501";

type Seen = { shared: { name: string; type: string; size: number }[][]; asked: { real: boolean; type: string }[][] };

async function signIn(page: Page, shareThrows?: string) {
  await page.addInitScript((shareThrows) => {
    const w = window as unknown as { __seen: Seen };
    w.__seen = { shared: [], asked: [] };
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: { files?: File[] }) => {
        w.__seen.asked.push((data.files ?? []).map((f) => ({ real: f instanceof File, type: f.type })));
        return true;
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files: File[] }) => {
        if (shareThrows) throw new TypeError(shareThrows);
        w.__seen.shared.push(data.files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      },
    });
  }, shareThrows);
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);

test.describe("Share on the phone layouts (real fetch)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "phone layouts");
  });

  test("1 photo from the viewer and 2 from the grid reach navigator.share as real Files", async ({ page }) => {
    await signIn(page);
    const cells = page.locator("img.mobile-library__cell");
    await cells.nth(0).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(async () => (await seen(page)).shared.length).toBe(1);
    await expect(page.getByText(/Couldn.t share/)).toHaveCount(0);
    await page.reload();
    await page.getByRole("tab", { name: "All Photos", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await cells.nth(0).click();
    await cells.nth(1).click();
    await page.getByTestId("select-bar").getByRole("button", { name: "Share", exact: true }).click();
    await expect.poll(async () => (await seen(page)).shared.length).toBe(1);
    const { shared, asked } = await seen(page);
    expect(shared[0]).toHaveLength(2);
    for (const file of shared[0]) {
      expect(file.type).toMatch(/^image\/jpeg$/);
      expect(file.size).toBeGreaterThan(0);
    }
    expect(asked.flat().length).toBeGreaterThan(0);
    for (const entry of asked.flat()) expect(entry).toEqual({ real: true, type: "image/jpeg" });
    await expect(page.getByTestId("transfer-hud")).toHaveCount(0);
  });

  test("a share sheet TypeError is reported as what it is, not as a dropped connection", async ({ page }) => {
    await signIn(page, "Type error");
    await page.locator("img.mobile-library__cell").nth(0).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const hud = page.getByTestId("transfer-hud");
    await expect(hud).toContainText("would not share these files (TypeError: Type error)");
    await expect(hud).not.toContainText("connection dropped");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${SHOTS}/508-${test.info().project.name}-share-error-honest.png` });
  });
});
