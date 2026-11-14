import type { RasterLayerSpecification } from "maplibre-gl";
import { OSM_TILE_TEMPLATE } from "./basemap";

// #374 experiment: paint the plain OSM raster tiles dark, same provider and
// same tile URLs. Variant 1 uses MapLibre raster paint properties; variant 2
// recolours every pixel in a protocol handler; variant 3 is both, tuned.
// Selected with ?mapdark=1..3 while comparing; default is the best one.
export type DarkVariant = 1 | 2 | 3;
export const DEFAULT_VARIANT: DarkVariant = 3;
export const DARK_PROTOCOL = "osmdark";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function darkVariant(search: string): DarkVariant {
  const v = new URLSearchParams(search).get("mapdark");
  return v === "1" || v === "2" || v === "3" ? (Number(v) as DarkVariant) : DEFAULT_VARIANT;
}

export function prefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(DARK_QUERY).matches;
}

// Calls `onChange` whenever the system theme flips. Returns an unsubscribe.
export function watchDark(onChange: (dark: boolean) => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  const handler = () => onChange(query.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

// Tile template the dark variants fetch from. 2 and 3 go through the
// protocol, which requests the very same OSM URL.
export function darkTileTemplate(variant: DarkVariant): string {
  return variant === 1 ? OSM_TILE_TEMPLATE : OSM_TILE_TEMPLATE.replace("https://tile.openstreetmap.org", `${DARK_PROTOCOL}://osm`);
}

// Variant 1 inverts luminance (min/max swapped) and rotates hue back, so
// blue water stays blue and green parks stay green; variant 3 adds a gentler
// version of that on top of the recoloured pixels, nothing (the pixels are
// already dark).
export function darkPaint(variant: DarkVariant): RasterLayerSpecification["paint"] {
  if (variant === 1) {
    return {
      "raster-brightness-min": 0.92,
      "raster-brightness-max": 0.1,
      "raster-hue-rotate": 180,
      "raster-saturation": -0.15,
      "raster-contrast": 0.1,
      "raster-fade-duration": 0,
    };
  }
  // Variant 3: the recoloured pixels plus a touch of contrast and saturation
  // so green and blue read as colour, not grey, at small sizes.
  if (variant === 3) return { "raster-fade-duration": 0, "raster-contrast": 0.12, "raster-saturation": 0.2 };
  return { "raster-fade-duration": 0 };
}

type RGB = [number, number, number];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Piecewise-linear lookup on a sorted [x, y] ramp.
function ramp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

// Dark palette, Apple-Maps-night-like.
const LAND: RGB = [28, 40, 32]; // #1c2820
const GREEN: RGB = [36, 62, 43]; // parks, forest
const WATER: RGB = [27, 45, 64]; // #1b2d40
const ROAD_GREY = 0.3;

function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Lightness ramp for the neutral colours: land (~0.93) and buildings/areas
// (0.83-0.9) become near-black, road fills (1.0) a muted grey, and dark label
// text (< 0.4) light. Antialiased edges are blends in lightness, so they stay
// monotone and no fringe appears.
const NEUTRAL: [number, number][] = [
  [0, 0.9],
  [0.25, 0.82],
  [0.5, 0.5],
  [0.7, 0.24],
  [0.83, 0.17],
  [0.93, 0.125],
  [0.97, 0.19],
  [1, ROAD_GREY],
];

export function recolor(r: number, g: number, b: number): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Land and neutral areas keep a green cast; labels and roads lose it.
  const landWeight = clamp01(1 - Math.abs(l - 0.9) / 0.2) * clamp01(1 - Math.max(0, s - 0.3) * 5);
  const lum = ramp(NEUTRAL, l);
  if (s > 0.12 && h >= 165 && h <= 245) {
    // Water: lightness from the blue tile, tinted blue-grey.
    const t = clamp01((l - 0.5) / 0.4);
    const c = mix([90, 120, 150], WATER, t);
    return [c[0], c[1], c[2]];
  }
  if (s > 0.1 && h >= 70 && h < 165) {
    // Parks, forest, grass: dark green; darker source greens (forest) a notch lighter.
    const t = clamp01((l - 0.55) / 0.35);
    const c = mix([52, 88, 62], GREEN, t);
    return [c[0], c[1], c[2]];
  }
  if (s > 0.5) {
    // Warm road fills (orange, yellow, pink) become muted greys with a hint of
    // their hue so road classes remain distinguishable.
    const base = 255 * (0.3 + 0.08 * clamp01((l - 0.6) / 0.3));
    const tint = clamp01(s) * 8;
    const warm = h < 70 || h > 300 ? 1 : 0;
    return [base + tint * warm, base + tint * 0.3, base - tint * 0.6 * warm];
  }
  const grey = 255 * lum;
  const out = mix([grey, grey, grey], LAND, landWeight);
  return out;
}

// Recolour RGBA pixels in place. Exported for tests.
export function recolorPixels(data: Uint8ClampedArray): void {
  const cache = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let packed = cache.get(key);
    if (packed === undefined) {
      const [r, g, b] = recolor(data[i], data[i + 1], data[i + 2]);
      packed = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
      cache.set(key, packed);
    }
    data[i] = packed >> 16;
    data[i + 1] = (packed >> 8) & 255;
    data[i + 2] = packed & 255;
  }
}

async function recolorTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  // The same URL, the same browser HTTP cache; OSM allows cross-origin reads.
  const response = await fetch(url, { signal, mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`tile ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixels(image.data);
  ctx.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

type Maplibre = Pick<typeof import("maplibre-gl"), "addProtocol">;
let registered = false;

export function registerDarkProtocol(maplibregl: Maplibre): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(DARK_PROTOCOL, async (params, abort) => {
    const real = params.url.replace(`${DARK_PROTOCOL}://osm`, "https://tile.openstreetmap.org");
    return { data: await recolorTile(real, abort.signal) };
  });
}
