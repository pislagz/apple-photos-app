import { type Page, expect, test } from "@playwright/test";

// #461: the admin library page names the real cause when a library can't be
// read. Needs the demo library put into that state first, outside the browser:
//   J461_STATE=busy           keep a WAL write open on demo-data/library/*/database/Photos.sqlite
//   J461_STATE=no_permission  chmod 000 the demo library's database/ folder
// Screenshots: $SHOT_DIR (default e2e/screenshots)/461-<state>-<project>-light.png
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const DIR = process.env.SHOT_DIR ?? "e2e/screenshots";
const STATE = process.env.J461_STATE ?? "";

const EXPECT: Record<string, { word: string; text: RegExp }> = {
  busy: { word: "Waiting for Photos", text: /Photos on the Mac is updating this library/ },
  no_permission: { word: "No permission", text: /Full Disk Access/ },
};

async function signIn(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("library status names the real cause", async ({ page }, info) => {
  test.skip(!(STATE in EXPECT), "set J461_STATE to busy or no_permission");
  test.skip(info.project.name !== "desktop", "desktop screenshot only");
  const want = EXPECT[STATE];
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Libraries", level: 1 })).toBeVisible();
  await expect(page.getByText(want.word).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${DIR}/461-${STATE}-${info.project.name}-list-light.png` });

  await page.getByText("Demo Library").first().click();
  await expect(page.getByText(want.text).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/is the drive mounted|Check that its drive is connected/)).toHaveCount(0);
  await page.screenshot({ path: `${DIR}/461-${STATE}-${info.project.name}-light.png` });
});
