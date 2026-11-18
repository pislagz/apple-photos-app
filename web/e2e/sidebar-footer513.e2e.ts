import { type Page, expect, test } from "@playwright/test";

// #513: the Mac sidebar's account footer stays pinned; only the list scrolls.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const OUT = "e2e-shots-n513";

async function signIn(page: Page) {
  await page.route("**/api/libraries/*/albums", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (let i = 0; i < 60; i++) {
      body.tree.push({
        id: `X${i}`, kind: "album", title: `Long list album ${i + 1}`, count: 3, cover_id: null, children: [],
      });
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test(`desktop short window, ${scheme}: footer pinned, hairline only when scrolled`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only");
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    const aside = page.locator("aside.sidebar");
    const scroller = aside.locator(".sidebar__scroll");
    const footer = aside.locator(".account-menu");
    await expect(aside.getByText("Long list album 60")).toBeAttached();
    await expect.poll(() => scroller.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);

    const inView = async () => {
      const f = await footer.boundingBox();
      return f!.y + f!.height <= 600 + 0.5 && f!.y >= 0;
    };
    const sepColor = () => footer.evaluate((e) => getComputedStyle(e).borderTopColor);
    const transparent = "rgba(0, 0, 0, 0)";

    // The aside itself never scrolls.
    expect(await aside.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
    expect(await inView()).toBe(true);
    await expect.poll(sepColor).not.toBe(transparent);
    await page.screenshot({ path: `${OUT}/${scheme}-top.png` });

    await scroller.evaluate((e) => (e.scrollTop = e.scrollHeight));
    expect(await inView()).toBe(true);
    await expect.poll(sepColor).toBe(transparent);
    await page.screenshot({ path: `${OUT}/${scheme}-bottom.png` });

    // Keyboard focus on a far item scrolls the list, footer stays put.
    await scroller.evaluate((e) => (e.scrollTop = 0));
    await aside.getByText("Long list album 40").focus().catch(() => {});
    await aside.getByRole("button", { name: /Long list album 40/ }).focus();
    expect(await inView()).toBe(true);
    await expect(aside.getByRole("button", { name: /Long list album 40/ })).toBeInViewport();

    // Footer menu still opens.
    await footer.getByRole("button").first().click();
    await expect(page.getByRole("menu").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/${scheme}-menu.png` });
  });
}
