import { type APIRequestContext, type Page, expect, request as pwRequest, test } from "@playwright/test";

// #518: per-library Utilities visibility. Off by default; the admin turns the
// section and each item on; the server refuses Hidden when it is off.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const BASE = process.env.DEMO_URL ?? "http://127.0.0.1:8000";
const SHOTS = process.env.SHOTS_DIR ?? "e2e/screenshots/n518";

async function api(who: { username: string; password: string }): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post("/api/auth/login", { data: who });
  expect(res.ok()).toBeTruthy();
  return ctx;
}

async function setUtilities(admin: APIRequestContext, body: object) {
  const res = await admin.put("/api/admin/libraries/1/utilities", { data: body });
  expect(res.ok()).toBeTruthy();
}

async function signIn(page: Page, who: { username: string; password: string }, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`admin Libraries switches (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iphone only");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const admin = await api(ADMIN);
    await setUtilities(admin, { enabled: false, imports: false, hidden: false });
    await signIn(page, ADMIN, "/admin");
    await page.getByText("Demo Library").first().click();
    const show = page.getByRole("switch", { name: "Show Utilities" });
    await expect(show).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Hidden" })).toBeDisabled();
    await show.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/admin-off-${info.project.name}-${scheme}.png` });

    await show.click();
    await expect(page.getByRole("switch", { name: "Hidden" })).toBeEnabled();
    await page.getByRole("switch", { name: "Hidden" }).click();
    await expect(page.getByRole("switch", { name: "Hidden" })).toHaveAttribute("aria-checked", "true");
    await page.getByText("Saved").first().waitFor({ state: "visible" }).catch(() => {});
    await page.screenshot({ path: `${SHOTS}/admin-on-${info.project.name}-${scheme}.png` });
    await setUtilities(admin, { enabled: false, imports: false, hidden: false });
    await admin.dispose();
  });

  test(`Utilities in the shell (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name === "small", "desktop and iphone only");
    const mobile = info.project.name === "iphone";
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const admin = await api(ADMIN);
    const user = await api(USER);
    await setUtilities(admin, { enabled: false, imports: false, hidden: false });

    // Server: Hidden is refused while off, whatever the UI shows.
    expect((await user.get("/api/libraries/1/hidden")).status()).toBe(404);

    await signIn(page, USER, mobile ? "/more" : "/");
    const area = mobile ? page.locator(".more-screen") : page.locator("aside.sidebar");
    await expect(area.getByRole("button", { name: /Videos|Library/ }).first()).toBeVisible();
    await expect(page.getByText("Utilities", { exact: true })).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-off-${scheme}.png` });

    // Only Imports on -> only Imports.
    await setUtilities(admin, { enabled: true, imports: true, hidden: false });
    await page.reload();
    await expect(page.getByText("Utilities", { exact: true })).toBeVisible();
    await expect(area.getByRole("button", { name: /Imports/ })).toBeVisible();
    await expect(area.getByRole("button", { name: /Hidden/ })).toHaveCount(0);
    expect((await user.get("/api/libraries/1/hidden")).status()).toBe(404);

    // Both on.
    await setUtilities(admin, { enabled: true, imports: true, hidden: true });
    await page.reload();
    await expect(area.getByRole("button", { name: /Hidden/ })).toBeVisible();
    await expect(area.getByRole("button", { name: /Imports/ })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-on-${scheme}.png` });

    // Section off beats item switches that stay on.
    await setUtilities(admin, { enabled: false });
    await page.reload();
    await expect(page.getByText("Utilities", { exact: true })).toHaveCount(0);
    expect((await user.get("/api/libraries/1/hidden")).status()).toBe(404);

    await setUtilities(admin, { enabled: false, imports: false, hidden: false });
    await admin.dispose();
    await user.dispose();
  });
}

test("Hidden open while switched off lands back on Library", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout");
  const admin = await api(ADMIN);
  await setUtilities(admin, { enabled: true, imports: false, hidden: true });
  await signIn(page, USER);
  await page.locator("aside.sidebar").getByRole("button", { name: "Hidden" }).click();
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Hidden" })).toBeVisible();

  await setUtilities(admin, { enabled: false });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hidden" })).toHaveCount(0);
  await expect(page.locator("aside.sidebar").getByRole("button", { name: "Library" })).toHaveAttribute("aria-current", "page");
  await setUtilities(admin, { enabled: false, imports: false, hidden: false });
  await admin.dispose();
});
