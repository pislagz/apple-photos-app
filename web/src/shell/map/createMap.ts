import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import type { MapConfig } from "../../api";
import { blankStyle, osmStyle, protomapsStyle, rasterPmtilesStyle } from "./basemap";

// One pmtiles protocol handler for the page: MapLibre keeps a single handler
// per scheme, so re-registering it on every map would only replace it.
let pmtilesProtocol: InstanceType<typeof import("pmtiles").Protocol> | null = null;

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

  // The local archive, as a style: the basemap without consent, and the
  // fallback with it. Null when it cannot be read.
  async function archiveStyle() {
    if (!config.pmtiles_url) return null;
    const { PMTiles, Protocol, TileType } = await import("pmtiles");
    const absolute = new URL(config.pmtiles_url, window.location.href).href;
    try {
      const archive = new PMTiles(absolute);
      const header = await archive.getHeader();
      if (!pmtilesProtocol) {
        pmtilesProtocol = new Protocol();
        maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
      }
      pmtilesProtocol.add(archive);
      const url = `pmtiles://${absolute}`;
      return header.tileType === TileType.Mvt ? protomapsStyle(url) : rasterPmtilesStyle(url);
    } catch {
      return null;
    }
  }

  let style = blankStyle();
  if (config.mode === "online") {
    style = osmStyle();
  } else if (config.mode === "local_file") {
    // Unreadable archive: blank background, never OSM (no consent).
    style = (await archiveStyle()) ?? blankStyle();
  }

  const map = new maplibregl.Map({
    container,
    style,
    attributionControl: false,
    renderWorldCopies: false,
    ...options,
  });
  // A tile that fails to load leaves the blank background and the pins. With
  // consent and a local archive, the first failed OSM tile switches the map to
  // the archive (once); no second tile host is ever tried.
  let switched = false;
  map.on("error", (event) => {
    const sourceId = (event as unknown as { sourceId?: string }).sourceId;
    if (switched || config.mode !== "online" || !config.pmtiles_url || sourceId !== "osm") return;
    switched = true;
    void archiveStyle().then((fallback) => {
      if (fallback) map.setStyle(fallback);
    });
  });
  return { map, maplibregl };
}
