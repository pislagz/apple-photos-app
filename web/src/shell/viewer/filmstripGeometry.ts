// Pure geometry for the centred scrubber filmstrip (#221). x values are px
// relative to the strip's horizontal centre, so the component only has to
// place a container at left: 50%.

export const STRIP_HEIGHT = 30;
export const SLIT_WIDTH = 18;
export const SLIT_GAP = 2;
export const PITCH = SLIT_WIDTH + SLIT_GAP;
// Rest state: the current photo is 30 px x aspect, clamped, plus padding.
export const CURRENT_MIN = 22;
export const CURRENT_MAX = 48;
export const CURRENT_PAD = 5;
export const VIDEO_MIN = 90;
export const VIDEO_PER_SECOND = 6;
export const VIDEO_MAX_FRACTION = 0.55;
export const MIN_BUFFER = 40;
// Pointer travel before a press becomes a drag (a tap stays a tap).
export const DRAG_THRESHOLD = 4;

export interface StripItem {
  width: number | null;
  height: number | null;
  is_video: boolean;
  duration: number | null;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function currentWidth(item: StripItem | undefined, stripWidth: number): number {
  if (item?.is_video) {
    const cap = Math.max(VIDEO_MIN, VIDEO_MAX_FRACTION * stripWidth);
    return clamp(VIDEO_MIN + VIDEO_PER_SECOND * (item.duration ?? 0), VIDEO_MIN, cap);
  }
  const aspect = item?.width && item.height ? item.width / item.height : 1;
  return clamp(STRIP_HEIGHT * aspect, CURRENT_MIN, CURRENT_MAX) + 2 * CURRENT_PAD;
}

export interface Cell {
  left: number;
  width: number;
}

// Resting layout: item `current` (width `curW`) is centred, others are slits.
export function restCell(i: number, current: number, curW: number): Cell {
  if (i === current) return { left: -curW / 2, width: curW };
  if (i > current) return { left: curW / 2 + SLIT_GAP + (i - current - 1) * PITCH, width: SLIT_WIDTH };
  return { left: -curW / 2 - (current - i) * PITCH, width: SLIT_WIDTH };
}

// While dragging every item is a slit and `pos` is a fractional index under
// the centre line, so the strip tracks the finger one-to-one.
export function dragCell(i: number, pos: number): Cell {
  return { left: (i - pos) * PITCH - SLIT_WIDTH / 2, width: SLIT_WIDTH };
}

export function clampPos(pos: number, count: number): number {
  return clamp(pos, 0, Math.max(0, count - 1));
}

// Finger moves right by dx -> the strip follows -> earlier items pass the centre.
export function posFromDrag(startPos: number, dx: number, count: number): number {
  return clampPos(startPos - dx / PITCH, count);
}

export function indexAtPos(pos: number, count: number): number {
  return clampPos(Math.round(pos), count);
}

// Inclusive window of indexes to mount around `center`: at least ±40 slits,
// more on a wide strip.
export function visibleRange(center: number, count: number, stripWidth: number): [number, number] {
  if (count === 0) return [0, -1];
  const buffer = Math.max(MIN_BUFFER, Math.ceil(stripWidth / 2 / PITCH) + 8);
  const c = indexAtPos(center, count);
  return [Math.max(0, c - buffer), Math.min(count - 1, c + buffer)];
}

// Horizontal position inside the current video cell -> 0..1 of its length.
export function videoFraction(dxFromCellLeft: number, cellWidth: number): number {
  return clamp(dxFromCellLeft / cellWidth, 0, 1);
}
