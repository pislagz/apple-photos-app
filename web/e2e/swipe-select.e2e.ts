import { expect, test, type Page } from "@playwright/test";

// #222: a horizontal one-finger drag in select mode selects a run across
// rows; a vertical drag does not select.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function enterSelect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.getByTestId("select-bar")).toBeVisible();
}

// Synthetic one-finger drag: Playwright's touchscreen only taps.
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, horizontalFirst = true) {
  await page.evaluate(
    ([a, b, hFirst]) => {
      const el = document.querySelector('[data-testid="library-scroll"]')!;
      const fire = (type: string, p: { x: number; y: number }) => {
        const target = document.elementFromPoint(p.x, p.y) ?? el;
        const touch = new Touch({ identifier: 1, target, clientX: p.x, clientY: p.y });
        target.dispatchEvent(
          new TouchEvent(type, { touches: type === "touchend" ? [] : [touch], changedTouches: [touch], bubbles: true, cancelable: true }),
        );
      };
      fire("touchstart", a);
      // First movement is horizontal, as the gesture is decided on it.
      if (hFirst) fire("touchmove", { x: a.x + 12, y: a.y });
      for (let i = 1; i <= 6; i += 1) fire("touchmove", { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
      fire("touchend", b);
    },
    [from, to, horizontalFirst] as const,
  );
}

test("horizontal drag selects a run across rows, then deselects it", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await enterSelect(page);
  const cells = page.locator("img.mobile-library__cell");
  // Oldest first (#224): the Library opens at its end, so the last cells are on screen.
  const a = (await cells.nth(-6).boundingBox())!;
  const b = (await cells.nth(-1).boundingBox())!;
  const centre = (box: typeof a) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await drag(page, centre(a), centre(b));
  await expect(page.getByTestId("select-bar")).toContainText(/6 (Photos|Videos|Items) Selected/);
  // Dragging back over the run (first tile selected) deselects it.
  await drag(page, centre(a), centre(b));
  await expect(page.getByTestId("select-bar")).toContainText("Select Items");
});

test("vertical drag selects nothing", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phone layout only");
  await enterSelect(page);
  const a = (await page.locator("img.mobile-library__cell").nth(1).boundingBox())!;
  await drag(page, { x: a.x + 10, y: a.y + 10 }, { x: a.x + 12, y: a.y + 120 }, false);
  await expect(page.getByTestId("select-bar")).toContainText("Select Items");
});
