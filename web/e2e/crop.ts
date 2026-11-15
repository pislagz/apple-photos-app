import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "@playwright/test";

/** #236: save a fixed-size crop of an element so a side-by-side check against
 *  the reference is repeatable. The crop starts at the element's top-left and
 *  is clamped to the viewport. Returns the path written. */
export async function cropElement(
  page: Page,
  selector: string,
  name: string,
  size: { width: number; height: number },
  dir = "e2e/screenshots/p236",
): Promise<string> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`cropElement: ${selector} has no box`);
  const vp = page.viewportSize() ?? { width: size.width, height: size.height };
  const clip = {
    x: Math.max(0, Math.min(box.x, vp.width - size.width)),
    y: Math.max(0, Math.min(box.y, vp.height - size.height)),
    width: Math.min(size.width, vp.width),
    height: Math.min(size.height, vp.height),
  };
  const path = `${dir}/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, clip });
  return path;
}
