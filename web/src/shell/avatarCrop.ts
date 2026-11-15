// Geometry for the avatar crop (#256). The circle is `diameter` CSS px wide.
// The photo is scaled to just cover it at zoom 1, then magnified by `zoom`.
// `offset` is where the photo's centre sits relative to the circle's centre.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Point {
  x: number;
  y: number;
}

export function displaySize(natural: { w: number; h: number }, diameter: number, zoom: number) {
  const scale = (diameter / Math.min(natural.w, natural.h)) * zoom;
  return { w: natural.w * scale, h: natural.h * scale };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// Keep the circle fully inside the photo.
export function clampOffset(offset: Point, size: { w: number; h: number }, diameter: number): Point {
  const maxX = Math.max(0, (size.w - diameter) / 2);
  const maxY = Math.max(0, (size.h - diameter) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, offset.y)) + 0,
  };
}

// The framed square as fractions of the photo, as the server expects it.
export function cropFractions(size: { w: number; h: number }, offset: Point, diameter: number) {
  const left = (size.w - diameter) / 2 - offset.x;
  const top = (size.h - diameter) / 2 - offset.y;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const width = Math.min(1, diameter / size.w);
  const height = Math.min(1, diameter / size.h);
  return {
    x: Math.min(clamp(left / size.w), 1 - width),
    y: Math.min(clamp(top / size.h), 1 - height),
    width,
    height,
  };
}
