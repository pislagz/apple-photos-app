import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

// #519 Family login. Screenshots go to SHOTS_DIR (default e2e-shots-n519, not committed).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.SHOTS_DIR ?? "e2e-shots-n519";
const ON = { enabled: true, passwordless_signin: "private" };

async function adminApi(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  return request;
}

async function ensureUser(api: APIRequestContext, username: string, extra: Record<string, unknown> = {}) {
  const created = await api.post("/api/admin/users", { data: { username, role: "user" } });
  expect([201, 409]).toContain(created.status());
  const patched = await api.patch(`/api/admin/users/${username}`, { data: { remove_password: true, ...extra } });
  expect(patched.ok()).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await adminApi(await playwright.request.newContext({ baseURL }));
  await ensureUser(api, "kid");
  await ensureUser(api, "ghost", { show_on_profiles: false });
  await api.put("/api/admin/settings/family-login", { data: ON });
  await api.dispose();
});

test.afterAll(async ({ playwright, baseURL }) => {
  const api = await adminApi(await playwright.request.newContext({ baseURL }));
  await api.put("/api/admin/settings/family-login", { data: ON });
  await api.dispose();
});

for (const scheme of ["light", "dark"] as const) {
  test(`profile screen and password step (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Who’s watching?" })).toBeVisible();
    await expect(page.getByRole("button", { name: USER.username })).toBeVisible();
    await expect(page.getByRole("button", { name: "kid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ghost" })).toHaveCount(0);
    await expect(page.getByLabel("Username")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/profiles-${info.project.name}-${scheme}.png` });

    await page.getByRole("button", { name: USER.username }).click();
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/password-${info.project.name}-${scheme}.png` });
  });
}

test("keyboard: Tab moves between profiles and Enter picks one", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.getByRole("button", { name: ADMIN.username }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: USER.username })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Password")).toBeFocused();
});

test("a profile with a password signs in; a wrong one is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: USER.username }).click();
  await page.getByLabel("Password").fill("not-the-password-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong password");
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get("/api/me")).json()).username)
    .toBe(USER.username);
});

test("a passwordless profile signs in with one tap, and has no Hidden", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "kid" }).click();
  await expect
    .poll(async () => (await (await page.request.get("/api/me")).json()).has_password)
    .toBe(false);
  if (info.project.name === "desktop") {
    await expect(page.locator(".sidebar").getByRole("button", { name: "Hidden" })).toHaveCount(0);
  }
  const hidden = await page.request.get("/api/libraries/1/hidden");
  expect([403, 404]).toContain(hidden.status());
});

test("Other user… opens the normal form; a hidden-from-screen user signs in there", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Other user…" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.getByLabel("Username").fill("ghost");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get("/api/me")).json()).username)
    .toBe("ghost");
});

test("Family login off shows the normal sign-in screen", async ({ page, playwright, baseURL }, info) => {
  const api = await adminApi(await playwright.request.newContext({ baseURL }));
  await api.put("/api/admin/settings/family-login", { data: { ...ON, enabled: false } });
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to profiles" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Other user…" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/family-off-${info.project.name}.png` });
  } finally {
    await api.put("/api/admin/settings/family-login", { data: ON });
    await api.dispose();
  }
});

async function signInAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

for (const scheme of ["light", "dark"] as const) {
  test(`admin settings and a person's password rows (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signInAdmin(page);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.goto("/admin#/settings");
    await expect(page.getByRole("combobox", { name: "Passwordless sign-in" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Family login" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: `${SHOTS}/admin-settings-${info.project.name}-${scheme}.png` });

    await page.goto("/admin#/people");
    await page.getByRole("button", { name: /^kid/ }).click();
    await expect(page.getByRole("button", { name: /Set Password/ })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Show kid on Who's watching" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: `${SHOTS}/admin-person-${info.project.name}-${scheme}.png` });
  });
}
