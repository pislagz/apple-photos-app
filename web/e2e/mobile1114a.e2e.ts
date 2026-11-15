import { type Page, expect, test } from "@playwright/test";

// #386-#389 mobile round. Phone projects only.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

test("#386 a saved 'desktop' layout is ignored and cleared on a phone", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("photos-viewer:layout-override", "desktop"));
  await signIn(page);
  await expect(page.locator(".shell--mobile")).toBeVisible();
  await expect(page.locator(".shell--desktop")).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("photos-viewer:layout-override"))).toBeNull();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  await expect(page.locator(".more-screen")).toBeVisible();
  await expect(page.getByText("Layout", { exact: true })).toHaveCount(0);
});

test("#387 the shell fills the viewport and the tab bar reaches the bottom edge", async ({ page }) => {
  await signIn(page);
  const m = await page.evaluate(() => {
    const shell = document.querySelector(".shell--mobile")!.getBoundingClientRect();
    const tab = document.querySelector(".tab-bar")!.getBoundingClientRect();
    return { top: shell.top, bottom: shell.bottom, tabBottom: tab.bottom, h: window.innerHeight };
  });
  expect(m.top).toBe(0);
  expect(Math.abs(m.bottom - m.h)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.tabBottom - m.h)).toBeLessThanOrEqual(1);
  // Not verified here: real iOS standalone (display-mode) rendering; Playwright cannot emulate it.
});

test("#389 More scrolls to the very end above the tab bar, rows are iOS-sized", async ({ page }) => {
  await signIn(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  const body = page.locator(".more-screen__body");
  await expect(body).toBeVisible();
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const m = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".more-screen__item"));
    const last = items[items.length - 1].getBoundingClientRect();
    const tab = document.querySelector(".tab-bar")!.getBoundingClientRect();
    const bodyBox = document.querySelector(".more-screen__body")!.getBoundingClientRect();
    const sw = document.querySelector(".more-screen__library-switcher")!.getBoundingClientRect();
    return {
      lastBottom: last.bottom,
      tabTop: tab.top,
      bodyBottom: bodyBox.bottom,
      switcherBottom: sw.bottom,
      minRow: Math.min(...items.map((i) => i.getBoundingClientRect().height)),
    };
  });
  expect(Math.abs(m.bodyBottom - m.tabTop)).toBeLessThanOrEqual(1);
  expect(m.lastBottom).toBeLessThanOrEqual(m.tabTop);
  expect(m.switcherBottom).toBeLessThanOrEqual(m.tabTop);
  expect(m.minRow).toBeGreaterThanOrEqual(44);
});

test("#388 the empty library is centred between the header and the view switch", async ({ page }) => {
  await page.route(/\/api\/libraries\/\d+\/(assets|summary)(\?.*)?$/, (route) => {
    const body = route.request().url().includes("/summary")
      ? { years: [], months: [], days: [] }
      : { items: [], next_cursor: null };
    return route.fulfill({ json: body });
  });
  await signIn(page);
  await expect(page.getByTestId("library-empty")).toBeVisible();
  const m = await page.evaluate(() => {
    const empty = document.querySelector('[data-testid="library-empty"]')!;
    const kids = Array.from(empty.children).map((c) => c.getBoundingClientRect());
    const top = Math.min(...kids.map((k) => k.top));
    const bottom = Math.max(...kids.map((k) => k.bottom));
    const left = Math.min(...kids.map((k) => k.left));
    const right = Math.max(...kids.map((k) => k.right));
    const header = document.querySelector(".mobile-library__top-bar")!.getBoundingClientRect();
    const sw = document.querySelector(".mobile-library__view-switch")!.getBoundingClientRect();
    return { top, bottom, left, right, headerBottom: header.bottom, switchTop: sw.top, w: window.innerWidth };
  });
  expect(m.top).toBeGreaterThanOrEqual(m.headerBottom);
  expect(m.bottom).toBeLessThanOrEqual(m.switchTop);
  const free = (m.top - m.headerBottom) - (m.switchTop - m.bottom);
  expect(Math.abs(free)).toBeLessThanOrEqual(24);
  expect(Math.abs((m.left + m.right) / 2 - m.w / 2)).toBeLessThanOrEqual(2);
});
