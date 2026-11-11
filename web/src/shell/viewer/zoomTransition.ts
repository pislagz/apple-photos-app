// Pure maths for the Viewer's open/close zoom (#220). No DOM, no React: the
// hook (useZoomTransition.ts) measures, this file decides what to animate.
//
// The animated element is the Viewer's stage. The photo sits centred in it at
// its "fit" size, so scaling the stage about its own centre by `scale` and
// moving its centre onto the tile's centre lands the photo on the tile; a
// clip-path inset on the stage (in its own, untransformed pixels) crops the
// photo to the tile's shape, so a square tile shows the same centre crop the
// grid thumbnail does and the crop opens up as the photo grows.

import type { Point, Size } from "./gestures";

// Local motion constants until the #206 motion tokens land on main; switch
// these to the tokens then.
export const ZOOM_OPEN_MS = 360;
export const ZOOM_CLOSE_MS = 300;
export const ZOOM_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
// Chrome and the backdrop fade over this share of the zoom (opening: the bars
// arrive as the photo settles; closing: they leave first).
export const ZOOM_FADE_MS = 240;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ZoomFrame {
  // Where the stage's centre sits relative to its resting place.
  dx: number;
  dy: number;
  scale: number;
  // Crop, in the stage's own pixels, applied before the transform.
  clip: Inset;
}

export const NO_CLIP: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
// The stage at rest: the Viewer fully open.
export const REST_FRAME: ZoomFrame = { dx: 0, dy: 0, scale: 1, clip: NO_CLIP };

export function centreOf(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// The frame that puts the photo (`fit`, centred in `stage`) exactly over
// `tile`, covering it (object-fit: cover, like the grid thumbnail). Null when
// the photo or the tile has no size, so the caller falls back to a fade.
export function tileFrame(stage: Rect, fit: Size, tile: Rect): ZoomFrame | null {
  if (fit.w <= 0 || fit.h <= 0 || tile.width <= 0 || tile.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return null;
  }
  const scale = Math.max(tile.width / fit.w, tile.height / fit.h);
  const stageCentre = centreOf(stage);
  const tileCentre = centreOf(tile);
  // The part of the stage that must stay visible is the tile, seen from
  // inside the scaled stage: tile size / scale, centred.
  const keepW = Math.min(stage.width, tile.width / scale);
  const keepH = Math.min(stage.height, tile.height / scale);
  const sideX = (stage.width - keepW) / 2;
  const sideY = (stage.height - keepH) / 2;
  return {
    dx: tileCentre.x - stageCentre.x,
    dy: tileCentre.y - stageCentre.y,
    scale,
    clip: { top: sideY, right: sideX, bottom: sideY, left: sideX },
  };
}

// The stage as the swipe-down dismiss leaves it: moved by the finger and
// shrunk, not cropped. The close zoom starts here so the hand-off has no jump.
export function dragFrame(drag: Point, scale: number): ZoomFrame {
  return { dx: drag.x, dy: drag.y, scale, clip: NO_CLIP };
}

export function frameTransform(frame: ZoomFrame): string {
  return `translate(${frame.dx}px, ${frame.dy}px) scale(${frame.scale})`;
}

export function frameClip(frame: ZoomFrame): string {
  const { top, right, bottom, left } = frame.clip;
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

export function frameKeyframe(frame: ZoomFrame): { transform: string; clipPath: string } {
  return { transform: frameTransform(frame), clipPath: frameClip(frame) };
}

// A tile that is entirely outside the window cannot be zoomed from or to; a
// partly visible one still can.
export function intersectsWindow(rect: Rect, window: Size): boolean {
  return rect.width > 0 && rect.height > 0 && rect.left < window.w && rect.left + rect.width > 0 && rect.top < window.h && rect.top + rect.height > 0;
}
