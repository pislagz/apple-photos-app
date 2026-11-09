import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import type { MapConfig } from "../../api";
import { blankStyle, osmStyle, protomapsStyle, rasterPmtilesStyle } from "./basemap";

// MapLibre (and pmtiles) load on first use, so the Library, Albums and People
// screens never even download the map code, let alone request tiles.
export async function createMap(
  container: HTMLElement,
  config: MapConfig,
  options: Partial<MapOptions> = {},
): Promise<{ map: MapLibreMap; maplibregl: typeof import("maplibre-gl") }> {
  const maplibregl = await import("maplibre-gl");
  // The worker is a same-origin file, not a blob, so the CSP needs no
  // `worker-src`; it falls back to `script-src 'self'`.
  const workerUrl = (await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url")).default;
  maplibregl.setWorkerUrl(workerUrl);

  let style = blankStyle();
  if (config.mode === "online") {
    style = osmStyle();
  } else if (config.mode === "local_file" && config.pmtiles_url) {
    const { PMTiles, Protocol, TileType } = await import("pmtiles");
    const absolute = new URL(config.pmtiles_url, window.location.href).href;
    try {
      const archive = new PMTiles(absolute);
      const header = await archive.getHeader();
      const protocol = new Protocol();
      protocol.add(archive);
      maplibregl.addProtocol("pmtiles", protocol.tile);
      const url = `pmtiles://${absolute}`;
      style = header.tileType === TileType.Mvt ? protomapsStyle(url) : rasterPmtilesStyle(url);
    } catch {
      // Unreadable archive: blank background. Never fall back to OSM.
      style = blankStyle();
    }
  }

  const map = new maplibregl.Map({
    container,
    style,
    attributionControl: false,
    renderWorldCopies: false,
    ...options,
  });
  // A tile that fails to load leaves the blank background and the pins. No
  // second tile host is tried.
  map.on("error", () => {});
  return { map, maplibregl };
}
