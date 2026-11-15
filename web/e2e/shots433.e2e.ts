import { test, type Page } from "@playwright/test";

// #433: iPhone grid at 4 and 1 per row, light and dark. Not part of CI.
const SHOTS = process.env.SHOTS_DIR ?? "./e2e/screenshots/j433";

async function pinch(page: Page, endGap: number) {
  await page.evaluate((gap) => {
    const target = document.querySelector('[data-testid="library-scroll"]')!;
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const touches = (spread: number) =>
      [-1, 1].map((side, id) => new Touch({ identifier: id, target, clientX: cx + (side * spread) / 2, clientY: cy }));
    const fire = (type: string, list: Touch[]) =>
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: list }));
    fire("touchstart", touches(100));
    fire("touchmove", touches(gap));
    fire("touchend", []);
  }, endGap);
}

for (const scheme of ["light", "dark"] as const) {
  test(`#433 shots ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "iphone", "iPhone only");
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByLabel("Username").fill("demo-user");
    await page.getByLabel("Password").fill("demo-user-pass-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".mobile-library__cell").first().waitFor();
    await pinch(page, 70);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-4-per-row.png` });
    await pinch(page, 300);
    await pinch(page, 300);
    await page.locator("img[data-sharp][data-loaded=true]").first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/iphone-${scheme}-1-per-row.png` });
  });
}
