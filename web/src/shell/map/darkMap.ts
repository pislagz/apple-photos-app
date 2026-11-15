import type { RasterLayerSpecification } from "maplibre-gl";

// #374: the dark map is the plain OSM raster tiles (same provider, same URLs)
// with MapLibre raster paint properties: luminance inverted (min/max swapped),
// hue rotated back so water stays blue and parks green.
export const DARK_BACKGROUND = "#1c2820";
export const DARK_PAINT: RasterLayerSpecification["paint"] = {
  "raster-brightness-min": 0.92,
  "raster-brightness-max": 0.1,
  "raster-hue-rotate": 180,
  "raster-saturation": -0.15,
  "raster-contrast": 0.1,
  "raster-fade-duration": 0,
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

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
