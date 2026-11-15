import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// The server sends `style-src 'self'`: an inline <style> or style="" in the
// shell page is blocked and logs a CSP violation on every load.
it("index.html has no inline style (CSP style-src 'self')", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  expect(html).not.toMatch(/<style[\s>]/i);
  expect(html).not.toMatch(/\sstyle\s*=/i);
  expect(html).toMatch(/<link rel="stylesheet" href="\/early\.css"/);
});
