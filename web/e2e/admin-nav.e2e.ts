import { type Page, expect, test } from "@playwright/test";

// #316: admin navigation shell. Screenshots: web/e2e/screenshots/316-<project>-<scheme>-*.png
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const SHOTS = "e2e/screenshots";

async function signIn(page: Page, hash = "") {
  await page.goto(`/admin${hash}`);
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Admin sections" });

for (const scheme of ["light", "dark"] as const) {
  test(`sidebar, list to detail and back (${scheme})`, async ({
    page,
    isMobile,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${SHOTS}/316-${info.project.name}-${scheme}`;
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Libraries", level: 1 }),
    ).toBeVisible();
    for (const name of [
      "Libraries",
      "People",
      "Sharing",
      "Devices",
      "Activity",
      "Settings",
    ]) {
      await expect(nav(page).getByRole("button", { name })).toBeVisible();
      await expect(
        nav(page).getByRole("button", { name }).locator("svg"),
      ).toHaveCount(1);
    }
    const exit = nav(page).getByRole("link", { name: "Back to Photos" });
    await expect(exit).toHaveAttribute("href", "/");
    if (isMobile)
      expect(
        (await nav(page).getByRole("button", { name: "People" }).boundingBox())!
          .height,
      ).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${tag}-sidebar.png` });

    await nav(page).getByRole("button", { name: "People" }).click();
    await expect(page).toHaveURL(/#people$/);
    await page.getByRole("button", { name: /demo-admin/ }).click();
    await expect(page).toHaveURL(/#people\/demo-admin$/);
    await expect(page.getByRole("button", { name: "‹ People" })).toBeVisible();
    if (isMobile) {
      await expect(nav(page)).toBeHidden();
      expect(
        (await page.getByRole("button", { name: "‹ People" }).boundingBox())!
          .height,
      ).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${tag}-detail.png` });

    await page.goBack();
    await expect(page).toHaveURL(/#people$/);
    await expect(
      page.getByRole("heading", { name: "People", level: 1 }),
    ).toBeVisible();
    await page.goForward();
    await expect(
      page.getByRole("heading", { name: "demo-admin", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "‹ People" }).click();
    await expect(
      page.getByRole("heading", { name: "People", level: 1 }),
    ).toBeVisible();
    await page.screenshot({ path: `${tag}-back.png` });
    expect(errors).toEqual([]);
  });

  test(`old hashes redirect (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(page, "#sessions");
    await expect(
      page.getByRole("heading", { name: "Devices", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#devices$/);
    await page.goto("/admin#audit");
    await expect(
      page.getByRole("heading", { name: "Activity", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#activity$/);
    await page.goto("/admin#users");
    await expect(
      page.getByRole("heading", { name: "People", level: 1 }),
    ).toBeVisible();
    await page.goto("/admin#access");
    await expect(
      page.getByRole("heading", { name: "Sharing", level: 1 }),
    ).toBeVisible();
    await page.goto("/admin#map-place-names");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#map-place-names$/);
    await page.goto("/admin#bogus");
    await expect(
      page.getByRole("heading", { name: "Libraries", level: 1 }),
    ).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/316-${info.project.name}-${scheme}-redirect.png`,
    });
  });
}

test("phone push-navigation slides unless reduced motion", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone only");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page, "#people");
  await page.getByRole("button", { name: /demo-admin/ }).click();
  const main = page.locator("main.admin-main");
  await expect(main).toHaveAttribute("data-nav", "forward");
  expect(await main.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "admin-push-in",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await main.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "none",
  );
});
