import { type CDPSession, type Page, expect, test } from "@playwright/test";

// #267 against the demo server (scripts/dev_demo.py): the Viewer opens a
// landscape and a portrait photo fitted (contain), zoom-out stops at fit,
// zoomed pan works in both axes and is clamped, and at fit a drag / swipe
// down closes. Runs in every project; the gestures differ per layout.
const USER = { username: "demo-user", password: "demo-user-pass-1" };
const SHOTS = "e2e/screenshots";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill(USER.username);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
}

async function openAllPhotos(page: Page) {
  if (await page.locator("aside.sidebar").count()) {
    await page.locator("aside.sidebar").getByRole("button", { name: "Library" }).click();
  }
  await page.getByRole("tab", { name: "All Photos", exact: true }).click();
  await expect(page.locator('[data-testid="library-cell"], .mobile-library__cell').first()).toBeVisible();
}

const viewer = (page: Page) => page.locator(".desktop-viewer, .mobile-viewer");

// The painted (object-fit: contain) rect of the current still, its transform
// and the natural orientation.
const still = (page: Page) =>
  page.evaluate(() => {
    const img = (document.querySelector(".mobile-viewer__page--current .viewer-still__main") ??
      document.querySelector(".viewer-still__main")) as HTMLImageElement | null;
    if (!img || !img.naturalWidth) return null;
    const r = img.getBoundingClientRect();
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec((img.parentElement as HTMLElement).style.transform);
    return {
      rect: { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h },
      x: Number(m?.[1] ?? 0),
      y: Number(m?.[2] ?? 0),
      scale: Number(m?.[3] ?? 1),
      landscape: img.naturalWidth > img.naturalHeight,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

async function openCell(page: Page, n: number, mobile: boolean) {
  const cell = page.locator('[data-testid="library-cell"], .mobile-library__cell').nth(n);
  if (mobile) await cell.tap();
  else await cell.dblclick();
  await expect(viewer(page)).toBeVisible();
  await expect.poll(async () => (await still(page))?.rect.w ?? 0).toBeGreaterThan(0);
  await page.waitForTimeout(400); // the open zoom
}

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
}

function touch(cdp: CDPSession) {
  const send = (type: "touchStart" | "touchMove" | "touchEnd", points: [number, number][]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  return {
    async swipe(from: [number, number], to: [number, number], steps = 8) {
      await send("touchStart", [from]);
      for (let i = 1; i <= steps; i++) {
        await send("touchMove", [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
      }
      await send("touchEnd", []);
    },
    async pinchIn(at: [number, number]) {
      await send("touchStart", [[at[0] - 50, at[1]], [at[0] + 50, at[1]]]);
      for (let i = 1; i <= 8; i++) await send("touchMove", [[at[0] - 50 + i * 5, at[1]], [at[0] + 50 - i * 5, at[1]]]);
      await send("touchEnd", []);
    },
    async doubleTap(at: [number, number]) {
      for (let i = 0; i < 2; i++) {
        await send("touchStart", [at]);
        await send("touchEnd", []);
      }
    },
  };
}

test("photos open fitted, zoom out stops at fit, zoomed pan is clamped in both axes, drag down closes", async ({ page }, info) => {
  const mobile = info.project.name !== "desktop";
  await signIn(page);
  await openAllPhotos(page);
  const seen = new Set<string>();
  for (let n = 0; n < 24 && seen.size < 2; n++) {
    await openCell(page, n, mobile);
    const fit = (await still(page))!;
    const kind = fit.landscape ? "landscape" : "portrait";
    if (seen.has(kind)) {
      await close(page);
      continue;
    }
    seen.add(kind);

    // Fitted: the whole photo is inside the viewport, touching it on one axis.
    expect(fit.scale).toBe(1);
    expect(fit.rect.x).toBeGreaterThanOrEqual(-1);
    expect(fit.rect.y).toBeGreaterThanOrEqual(-1);
    expect(fit.rect.x + fit.rect.w).toBeLessThanOrEqual(fit.vw + 1);
    expect(fit.rect.y + fit.rect.h).toBeLessThanOrEqual(fit.vh + 1);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-267-fit-${kind}.png` });

    const centre: [number, number] = [fit.rect.x + fit.rect.w / 2, fit.rect.y + fit.rect.h / 2];
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    const t = cdp ? touch(cdp) : null;

    // Zoom out at fit stays at fit.
    if (t) await t.pinchIn(centre);
    else {
      await page.mouse.move(...centre);
      await page.evaluate(([x, y]) => {
        const stage = document.querySelector('[data-testid="desktop-viewer-stage"]')!;
        for (let i = 0; i < 20; i++) {
          stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        }
      }, centre);
    }
    await page.waitForTimeout(400);
    expect((await still(page))!.scale).toBe(1);

    // Zoom in, pan diagonally: both axes move.
    if (t) await t.doubleTap(centre);
    else await page.mouse.dblclick(...centre);
    await page.waitForTimeout(400);
    const zoomed = (await still(page))!;
    expect(zoomed.scale).toBeGreaterThan(2);
    const dragBy = async (dx: number, dy: number) => {
      const to: [number, number] = [Math.min(Math.max(centre[0] + dx, 1), fit.vw - 1), Math.min(Math.max(centre[1] + dy, 1), fit.vh - 1)];
      if (t) await t.swipe(centre, to);
      else {
        await page.mouse.move(...centre);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 8 });
        await page.mouse.up();
      }
      await page.waitForTimeout(400);
      return (await still(page))!;
    };
    const panned = await dragBy(-40, -40);
    expect(panned.x).toBeLessThan(zoomed.x);
    expect(panned.y).toBeLessThan(zoomed.y);

    // Far past the edge: the photo's top-left stops at the stage's top-left
    // (below the top bar) on every axis where it overflows -- no empty gap.
    const stage = (await page.locator('[data-testid$="-viewer-stage"]').boundingBox())!;
    let edge = panned;
    for (let i = 0; i < 6; i++) edge = await dragBy(fit.vw, fit.vh);
    if (edge.rect.w > stage.width) expect(Math.abs(edge.rect.x - stage.x)).toBeLessThanOrEqual(1);
    if (edge.rect.h > stage.height) expect(Math.abs(edge.rect.y - stage.y)).toBeLessThanOrEqual(1);
    expect(edge.rect.w > stage.width || edge.rect.h > stage.height).toBe(true);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-267-zoomed-edge-${kind}.png` });

    // Back to fit, then drag / swipe down closes.
    if (t) await t.doubleTap(centre);
    else await page.mouse.dblclick(...centre);
    await page.waitForTimeout(400);
    expect((await still(page))!.scale).toBe(1);
    if (t) await t.swipe(centre, [centre[0], centre[1] + 300]);
    else {
      await page.mouse.move(...centre);
      await page.mouse.down();
      await page.mouse.move(centre[0], Math.min(centre[1] + 250, fit.vh - 1), { steps: 8 });
      await page.mouse.up();
    }
    await expect(viewer(page)).toHaveCount(0);
    await cdp?.detach();
  }
  expect([...seen].sort()).toEqual(["landscape", "portrait"]);
});

test("desktop: at fit a horizontal drag pages to the next and previous photo", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mouse drag is the desktop layout; touch paging is covered in MobileViewer tests");
  await signIn(page);
  await openAllPhotos(page);
  await openCell(page, 1, false);
  const src = async () => /\/(?:thumb|original)\/([^/?]+)/.exec((await page.locator(".viewer-still__main").getAttribute("src")) ?? "")?.[1];
  const first = await src();
  const box = (await page.getByTestId("desktop-viewer-stage").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (dx: number) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + 5, { steps: 8 });
    await page.mouse.up();
  };
  await drag(-200);
  await expect.poll(src).not.toBe(first);
  await drag(200);
  await expect.poll(src).toBe(first);
  await close(page);
});
