import { expect, test, type Page } from "@playwright/test";

// #470: long album / folder names in the desktop sidebar stay on one line,
// end in an ellipsis, and show the full name in a popover on hover (only when
// cut off). Uses the demo fixture's "wideo-kasety-mp4" folder. Screenshots go
// to ../e2e-shots-470/ (not committed); SHOTS_470_PHASE names them.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "../e2e-shots-470";
const SHOTS_474 = "e2e-shots-n474";
const PHASE = process.env.SHOTS_470_PHASE ?? "after";
const LONG_ALBUM = "3 - 06.08.1999r. Mazury, rejs po jeziorach z rodziną";
const LONG_FOLDER = "Kasety VHS przegrane w 2004 roku od cioci Basi";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

const sidebarClip = async (page: Page) => {
  const box = (await page.locator("aside.sidebar").boundingBox())!;
  return { x: 0, y: 0, width: Math.ceil(box.width) + 260, height: 900 };
};

for (const scheme of ["light", "dark"] as const) {
  test(`desktop sidebar: long names truncate, popover on hover (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const side = page.locator("aside.sidebar");
    const album = side.getByRole("button", { name: LONG_ALBUM, exact: true }).first();
    await album.scrollIntoViewIfNeeded();
    await expect(album).toBeVisible();
    await page.mouse.move(800, 450);
    await page.screenshot({ path: `${SHOTS}/${PHASE}-sidebar-${scheme}.png`, clip: await sidebarClip(page) });

    await album.hover();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/${PHASE}-hover-album-${scheme}.png`, clip: await sidebarClip(page) });
    if (PHASE === "before") return;

    // Every row is one 28px line; nothing wraps into the next row.
    const heights = await side.locator(".sidebar__item").evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    expect(new Set(heights)).toEqual(new Set([28]));
    const label = album.locator(".sidebar__label");
    expect(await label.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText(LONG_ALBUM);

    // A name that fits gets no popover.
    await side.getByRole("button", { name: "Busy Days", exact: true }).hover();
    await page.waitForTimeout(1200);
    await expect(tip).toHaveCount(0);

    const folder = side.locator("summary", { hasText: LONG_FOLDER });
    await folder.hover();
    await expect(tip).toHaveText(LONG_FOLDER);
    await page.screenshot({ path: `${SHOTS}/${PHASE}-hover-folder-${scheme}.png`, clip: await sidebarClip(page) });
  });
}

// #474: folders holding albums with the same long name. Exactly one tooltip,
// and it belongs to the row under the pointer.
for (const scheme of ["light", "dark"] as const) {
  test(`desktop sidebar: nested same-name albums show one tooltip (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const side = page.locator("aside.sidebar");
    const twins = side.locator("button", { hasText: LONG_ALBUM });
    await expect(twins).toHaveCount(2);
    await twins.nth(1).scrollIntoViewIfNeeded();
    const tips = page.getByRole("tooltip");
    for (const i of [0, 1, 0, 1]) {
      const box = (await twins.nth(i).locator(".sidebar__label").boundingBox())!;
      // Real pointer movement, not hover(): crossing from the previous row.
      await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 8 });
      await expect(tips).toHaveCount(1);
      await page.waitForTimeout(300);
      await expect(tips).toHaveCount(1);
      await expect(tips).toHaveText(LONG_ALBUM);
      const tip = (await tips.boundingBox())!;
      // Placed under the hovered row, not under the other twin.
      expect(Math.abs(tip.y - (box.y + box.height + 6))).toBeLessThan(8);
      if (i === 1) {
        await page.screenshot({ path: `${SHOTS_474}/hover-nested-${scheme}.png`, clip: await sidebarClip(page) });
      }
    }
    await page.mouse.move(900, 450);
    await expect(tips).toHaveCount(0);
  });
}
