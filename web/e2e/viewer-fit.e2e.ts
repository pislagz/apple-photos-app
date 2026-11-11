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
    // The main layer may still be loading the converted original; the
    // preview under it has the same box, so measure whichever has pixels.
    const scope = document.querySelector(".mobile-viewer__page--current") ?? document;
    const img = [...scope.querySelectorAll<HTMLImageElement>(".viewer-still > img")].find((layer) => layer.naturalWidth > 0);
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    // DOMMatrix, not a regex: pan offsets can be printed as 1.4e-14px.
    const m = new DOMMatrixReadOnly((img.parentElement as HTMLElement).style.transform || "none");
    return {
      rect: { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h },
      x: m.e,
      y: m.f,
      scale: Math.round(m.a * 1000) / 1000,
      landscape: img.naturalWidth > img.naturalHeight,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

// Opens cell n; false when it is not a still photo (video, Live Photo).
async function openCell(page: Page, n: number, mobile: boolean): Promise<boolean> {
  const cell = page.locator('[data-testid="library-cell"], .mobile-library__cell').nth(n);
  if (mobile) await cell.tap();
  else await cell.dblclick();
  await expect(viewer(page)).toBeVisible();
  const isStill = await page
    .locator(".viewer-still")
    .first()
    .waitFor({ timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  if (!isStill || (await page.locator(".desktop-viewer__media-wrap, .mobile-viewer__media-wrap").count())) return false;
  await expect.poll(async () => (await still(page))?.rect.w ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  // The open zoom from the tile (#220) marks the root with data-zoom until it
  // has finished; gestures and measurements before that see a moving photo.
  await expect(viewer(page)).not.toHaveAttribute("data-zoom", /.*/);
  await page.waitForTimeout(150);
  return true;
}

const currentIndex = (page: Page) =>
  page.locator('[data-testid="viewer-filmstrip"] [aria-current="true"]').getAttribute("data-index");

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
    if (!(await openCell(page, n, mobile))) {
      await close(page);
      continue;
    }
    const fit = (await still(page))!;
    const kind = fit.landscape ? "landscape" : "portrait";
    if (fit.rect.w === fit.rect.h || seen.has(kind)) {
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

    // Zoom in, pan diagonally: both axes move. One retry: a CDP double tap
    // can straddle the 300 ms window on a slow run.
    const tries: string[] = [];
    for (let attempt = 0; attempt < 2 && (await still(page))!.scale <= 1; attempt++) {
      if (t) await t.doubleTap(centre);
      else await page.mouse.dblclick(...centre);
      await page.waitForTimeout(400);
      tries.push(JSON.stringify({ n, centre, ...(await still(page)) }));
    }
    const zoomed = (await still(page))!;
    expect(zoomed.scale, `double tap/click to zoom: ${tries.join(" | ")}`).toBeGreaterThan(2);
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
    for (let attempt = 0; attempt < 2 && (await still(page))!.scale > 1; attempt++) {
      if (t) await t.doubleTap(centre);
      else await page.mouse.dblclick(...centre);
      await page.waitForTimeout(400);
    }
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

test("desktop cursor: arrow at fit, open hand when zoomed, closed hand while held, even over the bars (#257)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "pointer cursors are the desktop layout");
  await signIn(page);
  await openAllPhotos(page);
  expect(await openCell(page, 0, false)).toBe(true);
  const box = (await page.getByTestId("desktop-viewer-stage").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cursorAt = (x: number, y: number) =>
    page.evaluate(([px, py]) => getComputedStyle(document.elementFromPoint(px, py)!).cursor, [x, y]);
  expect(await cursorAt(cx, cy)).toBe("default");
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(400);
  await page.mouse.move(cx, cy);
  expect(await cursorAt(cx, cy)).toBe("grab");
  await page.mouse.down();
  expect(await cursorAt(cx, cy)).toBe("grabbing");
  await page.mouse.move(cx, 20, { steps: 5 });
  expect(await cursorAt(cx, 20)).toBe("grabbing");
  await page.mouse.up();
  expect(await cursorAt(cx, cy)).toBe("grab");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-257-grab.png` });
  await close(page);
});

test("desktop: at fit a horizontal drag pages to the next and previous photo", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mouse drag is the desktop layout; touch paging is covered in MobileViewer tests");
  await signIn(page);
  await openAllPhotos(page);
  // Its neighbours in the demo library are stills too, so the drag back
  // starts on a photo, not on a video's play button.
  expect(await openCell(page, 3, false)).toBe(true);
  const src = () => currentIndex(page);
  const first = await src();
  expect(first).toBe("3");
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
