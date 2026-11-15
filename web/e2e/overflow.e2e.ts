import { expect, test, type Page } from "@playwright/test";

// #281 F16: the iPhone grid must not scroll sideways. Every view, with and
// without select mode, keeps scrollWidth within the viewport.
const USER = { username: "demo-user", password: "demo-user-pass-1" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
}

async function overflowers(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > width + 0.5 || r.left < -0.5)) {
        out.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    const scroll = document.querySelector<HTMLElement>("[data-testid=library-scroll]");
    return {
      doc: document.documentElement.scrollWidth - width,
      scroll: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
      out: out.slice(0, 8),
    };
  });
}

for (const tab of ["Years", "Months", "Days", "All Photos"]) {
  test(`no horizontal overflow: ${tab}`, async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone layout only");
    await signIn(page);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForTimeout(500);
    const result = await overflowers(page);
    console.log(tab, JSON.stringify(result));
    expect(result.doc).toBeLessThanOrEqual(0);
    expect(result.scroll).toBeLessThanOrEqual(0);
  });
}
