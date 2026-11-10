import { type Page, expect, test } from "@playwright/test";

// P3.1: register and sign in with a passkey, using Chrome's virtual
// authenticator (CDP WebAuthn domain). WebAuthn rejects IP-address RP IDs, so
// this talks to the demo as http://localhost:<port> (still a secure context).
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const demo = process.env.DEMO_URL ?? "http://127.0.0.1:8000";
test.use({ baseURL: demo.replace("127.0.0.1", "localhost") });

async function openPasskeys(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Passkeys", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Passkeys" })).toBeVisible();
}

test("register a passkey, sign out, sign in with it, then remove it", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "one desktop ceremony is enough");
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);

  // A previous failed run may have left passkeys behind.
  for (const old of await (await page.request.get("/api/auth/passkeys")).json()) {
    await page.request.delete(`/api/auth/passkeys/${old.id}`);
  }

  await openPasskeys(page);
  await page.getByLabel("Passkey name").fill("E2E laptop");
  await page.getByLabel("Current password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("E2E laptop")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // The account menu stays open behind the closed dialog.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  const me = await (await page.request.get("/api/me")).json();
  expect(me.username).toBe(ADMIN.username);

  // Leave the demo as we found it.
  await openPasskeys(page);
  await page.getByRole("button", { name: "Remove E2E laptop" }).click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  expect(problems).toEqual([]);
});
