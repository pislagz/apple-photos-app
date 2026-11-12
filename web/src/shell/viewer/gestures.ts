// Pure maths for the Viewer's gestures (#214). No DOM, no React, so every
// threshold is unit-tested in gestures.test.ts and shared by the iPhone and
// desktop viewers.

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Sample extends Point {
  t: number;
}

// Thresholds from #214.
export const AXIS_LOCK_PX = 8;
export const PAGE_GAP_PX = 16;
export const PAGE_COMMIT_FRACTION = 0.25;
export const PAGE_COMMIT_VELOCITY = 0.5; // px/ms
export const DISMISS_DISTANCE_PX = 100;
export const DISMISS_VELOCITY = 0.6; // px/ms
export const DISMISS_FADE_PX = 300; // background reaches 0 here
export const DISMISS_MIN_SCALE = 0.8;
export const INFO_SWIPE_UP_PX = 100;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
export const DOUBLE_TAP_ZOOM = 2.5;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 40;
// The photo must stay settled this long before the full-resolution original
// is requested; paging resets the clock, so fast paging never fetches it.
export const ORIGINAL_DWELL_MS = 350;
const VELOCITY_WINDOW_MS = 100;

// Motion. Local constants until the #206 motion tokens land on main; switch
// these to the tokens then.
export const PAGE_SETTLE_MS = 300;
export const PAGE_SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const SPRING_BACK_MS = 250;
export const ZOOM_ANIM_MS = 250;
export const ORIGINAL_FADE_MS = 200;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// iOS-style rubber band: the offset grows ever more slowly and never
// reaches `dimension`.
export function rubberBand(offset: number, dimension: number): number {
  if (offset <= 0 || dimension <= 0) return 0;
  return (1 - 1 / ((offset * 0.55) / dimension + 1)) * dimension;
}

// Finger offset of the page strip: free between items, rubber-banded
// against the first and last item.
export function pagingOffset(dx: number, hasPrev: boolean, hasNext: boolean, width: number): number {
  if (dx > 0 && !hasPrev) return rubberBand(dx, width);
  if (dx < 0 && !hasNext) return -rubberBand(-dx, width);
  return dx;
}

export type PageDecision = "prev" | "next" | "stay";

// Commit past 25 % of the width or faster than 0.5 px/ms. Positive dx or
// velocity is a drag to the right, which shows the previous item.
export function pageDecision(
  dx: number,
  velocity: number,
  width: number,
  hasPrev: boolean,
  hasNext: boolean,
): PageDecision {
  const byDistance = Math.abs(dx) > width * PAGE_COMMIT_FRACTION;
  const byVelocity = Math.abs(velocity) > PAGE_COMMIT_VELOCITY && Math.abs(dx) >= AXIS_LOCK_PX;
  if (!byDistance && !byVelocity) return "stay";
  const direction = byVelocity && !byDistance ? Math.sign(velocity) : Math.sign(dx);
  if (direction > 0) return hasPrev ? "prev" : "stay";
  if (direction < 0) return hasNext ? "next" : "stay";
  return "stay";
}

// Strip translation in px for a settled page change.
export function pageTarget(decision: PageDecision, width: number): number {
  if (decision === "prev") return width + PAGE_GAP_PX;
  if (decision === "next") return -(width + PAGE_GAP_PX);
  return 0;
}

export interface DismissLook {
  scale: number;
  background: number; // 1 solid ... 0 transparent
}

export function dismissLook(dy: number): DismissLook {
  const progress = clamp(dy / DISMISS_FADE_PX, 0, 1);
  return { scale: 1 - (1 - DISMISS_MIN_SCALE) * progress, background: 1 - progress };
}

export function shouldDismiss(dy: number, velocity: number): boolean {
  if (dy > DISMISS_DISTANCE_PX) return true;
  return velocity > DISMISS_VELOCITY && dy >= AXIS_LOCK_PX;
}

export type Axis = "vertical" | "horizontal" | null;

// null until the finger has moved far enough to tell the axis.
export function lockAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
}

// px/ms over the last 100 ms of samples, per axis.
export function velocityOf(samples: Sample[]): Point {
  const last = samples[samples.length - 1];
  if (!last) return { x: 0, y: 0 };
  const first = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

export function clampZoom(scale: number): number {
  return clamp(scale, ZOOM_MIN, ZOOM_MAX);
}

// While pinching the scale may overshoot the limits a little (at most 15 %
// below fit, half a step above the maximum) and settles back on release.
export function softZoom(scale: number): number {
  if (scale > ZOOM_MAX) return ZOOM_MAX + 0.5 * (1 - 1 / (1 + (scale - ZOOM_MAX)));
  if (scale < ZOOM_MIN) return ZOOM_MIN - 0.15 * (1 - 1 / (1 + (ZOOM_MIN - scale) * 3));
  return scale;
}

// Drawn size of an object-fit: contain image inside a box.
export function fitSize(natural: Size, box: Size): Size {
  if (natural.w <= 0 || natural.h <= 0) return box;
  const ratio = Math.min(box.w / natural.w, box.h / natural.h);
  return { w: natural.w * ratio, h: natural.h * ratio };
}

// How far the zoomed image may be translated so its edge cannot leave the
// viewport. An axis where the image is smaller than the box cannot pan.
export function panBounds(scale: number, fit: Size, box: Size): Point {
  return {
    x: Math.max(0, (fit.w * scale - box.w) / 2),
    y: Math.max(0, (fit.h * scale - box.h) / 2),
  };
}

export function clampPan(pan: Point, bounds: Point): Point {
  return { x: clamp(pan.x, -bounds.x, bounds.x), y: clamp(pan.y, -bounds.y, bounds.y) };
}

// Translation that keeps the content under `focal` (relative to the box
// centre) fixed while the scale goes from `from` to `to`.
export function zoomAbout(pan: Point, from: number, to: number, focal: Point): Point {
  const k = to / from;
  return { x: focal.x - k * (focal.x - pan.x), y: focal.y - k * (focal.y - pan.y) };
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };

// Double-tap / double-click: fit <-> 2.5x with the tapped point moved to the
// centre (clamped, so it cannot show empty space).
export function toggleZoom(view: View, focal: Point, fit: Size, box: Size): View {
  if (view.scale > ZOOM_MIN + 0.01) return FIT;
  const pan = clampPan(
    { x: -DOUBLE_TAP_ZOOM * focal.x, y: -DOUBLE_TAP_ZOOM * focal.y },
    panBounds(DOUBLE_TAP_ZOOM, fit, box),
  );
  return { scale: DOUBLE_TAP_ZOOM, ...pan };
}

// Pinch (touch) or ctrl+wheel (desktop) step: `scale` is the requested new
// scale, `focal` the pinch midpoint relative to the box centre.
export function zoomView(view: View, scale: number, focal: Point, fit: Size, box: Size): View {
  const next = softZoom(scale);
  const moved = zoomAbout(view, view.scale, next, focal);
  return { scale: next, ...clampPan(moved, panBounds(Math.max(next, ZOOM_MIN), fit, box)) };
}

// After the fingers lift: back inside 1-6 and inside the pan bounds.
export function settleView(view: View, fit: Size, box: Size): View {
  const scale = clampZoom(view.scale);
  if (scale <= ZOOM_MIN) return FIT;
  return { scale, ...clampPan(view, panBounds(scale, fit, box)) };
}

// #267 desktop mouse drag at fit: the photo follows the mouse along the
// locked axis (down only, for dismiss) and on release pages or closes.
export const MOUSE_PAGE_DRAG_PX = 80;

export function fitDragView(delta: { dx: number; dy: number }): View {
  const axis = lockAxis(delta.dx, delta.dy);
  if (axis === "horizontal") return { scale: 1, x: delta.dx, y: 0 };
  if (axis === "vertical" && delta.dy > 0) return { scale: dismissLook(delta.dy).scale, x: 0, y: delta.dy };
  return FIT;
}

export function fitDragOutcome(delta: { dx: number; dy: number }, box: Size): "prev" | "next" | "close" | null {
  const axis = lockAxis(delta.dx, delta.dy);
  if (axis === "horizontal") {
    if (Math.abs(delta.dx) < Math.min(MOUSE_PAGE_DRAG_PX, box.w * PAGE_COMMIT_FRACTION)) return null;
    return delta.dx > 0 ? "prev" : "next";
  }
  if (axis === "vertical" && delta.dy > DISMISS_DISTANCE_PX) return "close";
  return null;
}

// Wheel zoom: ctrl+wheel deltaY (trackpad pinch) to a scale factor.
export function wheelScale(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY * 0.01));
}
