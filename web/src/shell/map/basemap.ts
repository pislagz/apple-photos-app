import type { RasterLayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapConfig } from "../../api";

// The one place a tile URL is written down. The browser fetches these only
// while a map is mounted; the server never sees them (docs/SPEC.md "No
// outbound network"). No glyphs or sprites: our pins are DOM elements, so the
// style has no text layers and nothing to load from a font server.
export const OSM_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

const BLANK = "#e9e8e4";

export function blankStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": BLANK } }],
  };
}

// `dark`: #374, the same OSM tiles painted dark (see darkMap.ts).
export function osmStyle(dark?: { tiles: string; paint: RasterLayerSpecification["paint"]; background: string }): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: { type: "raster", tiles: [dark?.tiles ?? OSM_TILE_TEMPLATE], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": dark?.background ?? BLANK } },
      { id: "osm", type: "raster", source: "osm", paint: dark?.paint ?? {} },
    ],
  };
}

// Protomaps basemap layers (earth, water, landuse, roads, boundaries), drawn
// with our own colours and no labels.
export function protomapsStyle(sourceUrl: string): StyleSpecification {
  const source = "pm";
  return {
    version: 8,
    sources: { [source]: { type: "vector", url: sourceUrl } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#aad3df" } },
      { id: "earth", type: "fill", source, "source-layer": "earth", paint: { "fill-color": BLANK } },
      {
        id: "landuse",
        type: "fill",
        source,
        "source-layer": "landuse",
        paint: { "fill-color": "#d6e8c4", "fill-opacity": 0.7 },
      },
      { id: "water", type: "fill", source, "source-layer": "water", paint: { "fill-color": "#aad3df" } },
      {
        id: "roads",
        type: "line",
        source,
        "source-layer": "roads",
        paint: { "line-color": "#ffffff", "line-width": 1.2 },
      },
      {
        id: "boundaries",
        type: "line",
        source,
        "source-layer": "boundaries",
        paint: { "line-color": "#b4a7c5", "line-width": 0.8, "line-dasharray": [3, 2] },
      },
    ],
  };
}

export function rasterPmtilesStyle(sourceUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: { pm: { type: "raster", url: sourceUrl, tileSize: 256 } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": BLANK } },
      { id: "pm", type: "raster", source: "pm" },
    ],
  };
}

// True when a basemap is drawn (and so needs the OSM attribution).
export function hasBasemap(config: MapConfig): boolean {
  return config.mode === "online" || (config.mode === "local_file" && !!config.pmtiles_url);
}
