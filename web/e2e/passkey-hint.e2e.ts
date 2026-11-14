import { expect, test } from "@playwright/test";

// #379: over a bare IP (the demo on 127.0.0.1) passkeys can't work, so the login card
// shows "How to log in using passkeys? (i)" instead of the footnote; hover or tap opens the text.
for (const scheme of ["light", "dark"] as const) {
  test(`passkey hint popover, ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.context().clearCookies();
    await page.goto("/");
    const hint = page.getByRole("button", { name: "How to log in using passkeys?" });
    await expect(hint).toBeVisible();
    await expect(page.getByText(/Passkeys need a secure/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeHidden();
    if (info.project.name === "desktop") await hint.hover();
    else await hint.tap();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("photos.example.com");
    const box = (await tip.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await page.screenshot({ path: `e2e/screenshots/379/login-hint-${info.project.name}-${scheme}.png` });
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });
}
