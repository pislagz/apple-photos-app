import type { MapConfig } from "../../api";
import { hasBasemap, OSM_COPYRIGHT_URL } from "./basemap";

// Shown on every map that draws a basemap, the mini-map included. Off mode
// draws none, so there is nothing to credit.
export default function Attribution({ config }: { config: MapConfig }) {
  if (!hasBasemap(config)) return null;
  return (
    <div className="map-attribution">
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
