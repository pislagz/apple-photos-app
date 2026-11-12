import { type Page, expect, test } from "@playwright/test";

// F2 / F6 / F10 against the demo server (scripts/dev_demo.py).
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function openAllPhotos(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  if (await page.locator("aside.sidebar").count()) {
    await page
      .locator("aside.sidebar")
      .getByRole("button", { name: "Library" })
      .click();
  }
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(
    page.locator('[data-testid="library-cell"], .mobile-library__cell').first(),
  ).toBeVisible();
}

test("F2: a clicked desktop tile shows no white flash, only the blue frame", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await openAllPhotos(page);
  const cell = page.locator('[data-testid="library-cell"]').first();
  await cell.click();
  await expect(cell).toHaveAttribute("data-selected", "true");
  const style = await cell.evaluate((el) => {
    const after = getComputedStyle(el, "::after");
    const own = getComputedStyle(el);
    return {
      content: after.content,
      outlineStyle: own.outlineStyle,
      tap: own.getPropertyValue("-webkit-tap-highlight-color"),
    };
  });
  expect(style.content === "none" || style.content === "normal").toBe(true);
  expect(style.outlineStyle).toBe("solid");
  await expect(cell).not.toHaveAttribute("data-flash");
});

test("F6: every desktop zoom step keeps a stable grid width and column count", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await openAllPhotos(page);
  const slider = page.getByLabel("Zoom");
  for (let step = 0; step <= 4; step++) {
    await slider.fill(String(step));
    const samples: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);
      samples.push(
        await page.evaluate(() => {
          const grid = document.querySelector(
            ".desktop-library__grid",
          ) as HTMLElement;
          const first = document.querySelector(
            '[data-testid="library-cell"]',
          ) as HTMLElement;
          return `${grid.clientWidth}:${Math.round(first.getBoundingClientRect().width)}`;
        }),
      );
    }
    expect(
      new Set(samples.slice(3)).size,
      `zoom step ${step}: ${samples.join(" ")}`,
    ).toBe(1);
  }
});

test("F10: the iPhone check badge is static and centred from the first frame", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "iphone");
  await openAllPhotos(page);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const tile = page.locator(".mobile-library__cell-wrap").first();
  await tile.locator(".mobile-library__cell").first().click();
  const badge = tile.locator(".mobile-library__check");
  await expect(badge).toHaveAttribute("data-selected", "true");
  const read = () =>
    badge.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const p = el.querySelector("path")!.getBoundingClientRect();
      return {
        dx: p.left + p.width / 2 - (b.left + b.width / 2),
        dy: p.top + p.height / 2 - (b.top + b.height / 2),
        x: b.left,
        y: b.top,
      };
    });
  const first = await read();
  await page.waitForTimeout(500);
  const later = await read();
  expect(later).toEqual(first);
  expect(Math.abs(first.dx)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(first.dy)).toBeLessThanOrEqual(0.5);
});
