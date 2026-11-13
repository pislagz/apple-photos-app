import { type Locator, type Page, expect, test } from "@playwright/test";

// #268 / T4: every settings row reads [label] (i) ---space---> [control]. The (i)
// hugs the label's right edge and the control stays on the right. Shots go to
// $INFO_SHOTS_DIR when set.
const ADMIN = { username: "demo-admin", password: "demo-admin-pass-1" };
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = process.env.INFO_SHOTS_DIR;

async function signIn(page: Page, path: string, who: typeof ADMIN) {
  await page.goto(path);
  await page.getByLabel("Username").fill(who.username);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

// The tight text box of a label: its content range, so a wide flex box does not hide a gap.
async function textRight(label: Locator): Promise<number> {
  return label.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Math.max(...Array.from(range.getClientRects()).map((r) => r.right));
  });
}

// `rows` are the elements that hold the label and its (i). `outer` finds the whole row
// (for the control and the right edge): by default the row itself.
async function checkRows(
  page: Page,
  rows: Locator,
  viewportWidth: number,
  narrow: boolean,
  outer: (row: Locator) => { row: Locator; control: Locator } = (row) => ({
    row,
    control: row.locator("> :not(label):not(.info-button)").first(),
  }),
  labelSel = "> label",
) {
  await rows.first().waitFor();
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await row.scrollIntoViewIfNeeded();
    const label = row.locator(labelSel);
    const info = row.locator("> .info-button");
    const labelBox = (await label.boundingBox())!;
    const infoBox = (await info.boundingBox())!;
    const text = (await label.textContent())!.trim();
    // Touch screens give the (i) a 44px hit area with negative margins, so its box
    // overlaps the label's edge by a few px while the 16px icon stays visibly clear.
    const gap = infoBox.x - (await textRight(label));
    expect(gap, `(i) hugs "${text}"`).toBeGreaterThanOrEqual(-8);
    // A wrapped label's box is wider than its last line, so allow for that on phones.
    expect(gap, `(i) hugs "${text}"`).toBeLessThanOrEqual(narrow ? 40 : 16);
    expect(infoBox.x, text).toBeLessThanOrEqual(labelBox.x + labelBox.width + (narrow ? 40 : 16));
    // Vertically centred on the first text line when the label is a single line.
    if (labelBox.height < 30) {
      expect(Math.abs(infoBox.y + infoBox.height / 2 - (labelBox.y + labelBox.height / 2)), text).toBeLessThanOrEqual(3);
    }
    const whole = outer(row);
    const control = whole.control;
    const controlBox = (await control.boundingBox())!;
    // Beside the control, or (phone) above it when the control drops to its own line.
    const above = infoBox.y + infoBox.height <= controlBox.y + 12;
    if (!above) {
      expect(infoBox.x + infoBox.width, `(i) left of the control: ${text}`).toBeLessThanOrEqual(controlBox.x + 6);
    }
    expect(controlBox.x + controlBox.width, text).toBeLessThanOrEqual(viewportWidth);
    if (!narrow) {
      // The control stays right-aligned within the row.
      const rowBox = (await whole.row.boundingBox())!;
      expect(controlBox.x + controlBox.width, `control right-aligned: ${text}`).toBeGreaterThan(rowBox.x + rowBox.width - 20);
    }
  }
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name === "small", "desktop 1440 and iPhone 390 are the targets");
});

for (const scheme of ["light", "dark"] as const) {
  test(`admin Settings rows: (i) after the label (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page, "/admin", ADMIN);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const narrow = page.viewportSize()!.width < 600;
    await checkRows(
      page,
      page.locator(".admin-settings .admin-row__heading"),
      page.viewportSize()!.width,
      narrow,
      (heading) => {
        const row = heading.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' admin-row ')][1]");
        return { row, control: row.locator(".admin-row__control").first() };
      },
      "> .admin-row__label, > label",
    );
    const buttonRows = page.locator(".admin-settings .admin-row__control:has(> button.admin-btn + .info-button)");
    expect(await buttonRows.count()).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < (await buttonRows.count()); i++) {
      const button = buttonRows.nth(i).locator("> button").first();
      const next = button.locator("xpath=following-sibling::*[1]");
      await expect(next).toHaveClass(/info-button/);
      const a = (await button.boundingBox())!;
      const b = (await next.boundingBox())!;
      expect(b.x - (a.x + a.width)).toBeLessThanOrEqual(16);
    }
    if (SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-admin-settings-${scheme}.png`, fullPage: true });
    }
  });

  // test-all: #292 (Mac account menu) and #303 (More tab) replaced the popover this checked, so
  // the old "Account menu" popover with label/(i)/control rows no longer exists. The (i) order
  // is still covered by AccountMenu.info.test.tsx. Re-aim at the More tab's Layout row.
  test.skip(`account-menu settings: (i) after the label (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page, "/", USER);
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.locator(".account-menu__popover");
    await expect(menu).toBeVisible();
    const layout = menu.locator(".layout-override");
    await checkRows(page, layout, page.viewportSize()!.width, true);
    for (const name of ["Change password", "Passkeys"]) {
      const button = menu.getByRole("button", { name, exact: true });
      const a = (await button.boundingBox())!;
      const b = (await menu.getByRole("button", { name: `About ${name}` }).boundingBox())!;
      expect(b.x - (a.x + a.width), name).toBeLessThanOrEqual(16);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-account-menu-${scheme}.png` });
  });
}
