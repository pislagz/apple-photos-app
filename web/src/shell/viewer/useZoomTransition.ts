import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import { fitSize } from "./gestures";
import { thumbnailFor } from "./focusScope";
import { prefersReducedMotion } from "./useDismiss";
import {
  REST_FRAME,
  ZOOM_CLOSE_MS,
  ZOOM_EASE,
  ZOOM_FADE_MS,
  ZOOM_OPEN_MS,
  type ZoomFrame,
  frameKeyframe,
  intersectsWindow,
  tileFrame,
} from "./zoomTransition";

// The bars and panels of both Viewers; they fade with the backdrop while the
// stage zooms.
const CHROME_SELECTOR = [
  ".mobile-viewer__topbar",
  ".mobile-viewer__bottombar",
  ".desktop-viewer__topbar",
  ".desktop-viewer__filmstrip",
  ".desktop-viewer__info-panel",
].join(", ");

export interface ZoomOut {
  finished: Promise<unknown>;
  // Drop the animation's hold on the DOM (a Viewer that outlives onClose).
  cancel: () => void;
}

interface Options {
  rootRef: RefObject<HTMLElement | null>;
  stageRef: RefObject<HTMLElement | null>;
  // The shown item: its id finds the tile, its pixel size gives the fit.
  item: { id: string; width: number | null; height: number | null } | undefined;
}

function supported(root: HTMLElement | null, stage: HTMLElement | null): boolean {
  return !!root && !!stage && typeof stage.animate === "function" && !prefersReducedMotion();
}

function fade(el: Element, property: "opacity" | "backgroundColor", from: string, to: string, ms: number, fill: FillMode) {
  return el.animate({ [property]: [from, to] }, { duration: ms, easing: "ease-in-out", fill });
}

function hide(tile: HTMLElement): () => void {
  const before = tile.style.visibility;
  tile.style.visibility = "hidden";
  return () => {
    tile.style.visibility = before;
  };
}

// #220: the Viewer opens by zooming from the tapped tile and closes by zooming
// back into the tile of the item it is showing then (after paging, a different
// tile than it opened from). With no tile on screen, or reduced motion, it
// returns to the plain fade (open) / `null` (close, useDismiss fades).
export function useZoomTransition({ rootRef, stageRef, item }: Options) {
  const itemRef = useRef(item);
  itemRef.current = item;

  // The Viewer is laid out but not yet painted: the right moment to start.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const current = itemRef.current;
    if (!current || !root || !stage || !supported(root, stage)) return;
    const tile = thumbnailFor(current.id);
    if (!tile) return;
    // The CSS fade-up is the fallback; the zoom replaces it. Set before
    // measuring, or the fade-up's scale(0.97) would skew the stage's rectangle.
    root.dataset.zoom = "1";
    const frame = playable(stage, current, tile);
    if (!frame) {
      delete root.dataset.zoom;
      return;
    }
    const animations: Animation[] = [stage.animate([frameKeyframe(frame), frameKeyframe(REST_FRAME)], { duration: ZOOM_OPEN_MS, easing: ZOOM_EASE, fill: "backwards" })];
    const style = getComputedStyle(root);
    animations.push(fade(root, "backgroundColor", "transparent", style.backgroundColor, ZOOM_FADE_MS, "backwards"));
    for (const bar of root.querySelectorAll(CHROME_SELECTOR)) {
      animations.push(fade(bar, "opacity", "0", getComputedStyle(bar).opacity, ZOOM_OPEN_MS, "backwards"));
    }
    const show = hide(tile);
    const done = () => {
      show();
      delete root.dataset.zoom;
    };
    Promise.all(animations.map((a) => a.finished)).then(done, done);
    return () => {
      for (const a of animations) a.cancel();
      done();
    };
    // Only the first open: later items are reached by paging inside the Viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the close zoom from `from` (the stage as a swipe-down left it).
  // Null means "no zoom possible": the caller plays the fade instead.
  const zoomOut = useCallback(
    (from: ZoomFrame = REST_FRAME): ZoomOut | null => {
      const root = rootRef.current;
      const stage = stageRef.current;
      const current = itemRef.current;
      if (!current || !root || !stage || !supported(root, stage)) return null;
      const tile = thumbnailFor(current.id);
      if (!tile) return null;
      const frame = playable(stage, current, tile, from);
      if (!frame) return null;
      root.dataset.zoom = "1";
      const style = getComputedStyle(root);
      const animations: Animation[] = [
        stage.animate([frameKeyframe(from), frameKeyframe(frame)], { duration: ZOOM_CLOSE_MS, easing: ZOOM_EASE, fill: "forwards" }),
        fade(root, "backgroundColor", style.backgroundColor, "transparent", ZOOM_CLOSE_MS, "forwards"),
      ];
      for (const bar of root.querySelectorAll(CHROME_SELECTOR)) {
        animations.push(fade(bar, "opacity", getComputedStyle(bar).opacity, "0", ZOOM_CLOSE_MS - 60, "forwards"));
      }
      const show = hide(tile);
      const finished = Promise.all(animations.map((a) => a.finished));
      return {
        finished,
        cancel: () => {
          for (const a of animations) a.cancel();
          show();
          delete root.dataset.zoom;
        },
      };
    },
    [rootRef, stageRef],
  );

  return { zoomOut };
}

// The frame for `tile`, or null when it cannot be used. `from` is the stage's
// current transform: its rest rectangle is recovered by undoing it.
function playable(stage: HTMLElement, item: { width: number | null; height: number | null }, tile: HTMLElement, from: ZoomFrame = REST_FRAME) {
  const tileRect = tile.getBoundingClientRect();
  if (!intersectsWindow(tileRect, { w: window.innerWidth, h: window.innerHeight })) return null;
  const measured = stage.getBoundingClientRect();
  const width = measured.width / from.scale;
  const height = measured.height / from.scale;
  const stageRect = {
    left: measured.left + measured.width / 2 - from.dx - width / 2,
    top: measured.top + measured.height / 2 - from.dy - height / 2,
    width,
    height,
  };
  const fit = fitSize({ w: item.width ?? 0, h: item.height ?? 0 }, { w: width, h: height });
  return tileFrame(stageRect, fit, tileRect);
}
