import { expect, test } from "@playwright/test";

// The Sign in button lines up with the fields instead of overhanging them:
// on desktop the inputs' width and height, on a phone the fields group's
// width at 44pt, sitting below the group rather than fused onto it.
test("Sign in button is sized to the fields", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByLabel("Username")).toBeVisible();
  const submit = (await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox())!;
  if (info.project.name === "desktop") {
    const input = (await page.getByLabel("Password").boundingBox())!;
    expect(Math.abs(submit.x - input.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.width - input.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.height - input.height)).toBeLessThanOrEqual(1);
  } else {
    const group = (await page.locator(".login-card form > label").last().boundingBox())!;
    expect(Math.abs(submit.x - group.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.width - group.width)).toBeLessThanOrEqual(1);
    expect(submit.height).toBeGreaterThanOrEqual(44);
    expect(submit.height).toBeLessThanOrEqual(50);
    expect(submit.y).toBeGreaterThanOrEqual(group.y + group.height + 8);
  }
});
