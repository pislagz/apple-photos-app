import { useCallback, useEffect, useRef, useState } from "react";
import { getMapClusters, type MapBounds, type MapCluster, type MapConfig } from "../../api";
import Attribution from "./Attribution";
import { createMap } from "./createMap";
import { useMapConfig } from "./useMapConfig";

// A cluster this small (or a map this close) opens its photos instead of zooming.
const OPEN_AT_ZOOM = 16;

export function boundsParam(b: MapBounds): string {
  return `${b.west},${b.south},${b.east},${b.north}`;
}

function pinElement(libraryId: number, cluster: MapCluster, onClick: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-pin";
  button.setAttribute("aria-label", cluster.count === 1 ? "1 photo" : `${cluster.count} photos`);
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.src = `/api/libraries/${libraryId}/thumb/${encodeURIComponent(cluster.cover_id)}?size=grid`;
  button.append(img);
  if (cluster.count > 1) {
    const badge = document.createElement("span");
    badge.className = "map-pin__count";
    badge.textContent = String(cluster.count);
    button.append(badge);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

// P2.3: the Map screen. Mounting it is the only thing that makes the browser
// request basemap tiles (OSM mode); unmounting removes the map.
export default function MapView({
  libraryId,
  onOpenPlace,
}: {
  libraryId: number;
  // Open the photos inside `bounds` in the ordinary grid.
  onOpenPlace: (bounds: MapBounds) => void;
}) {
  const { config, error: configError, retry: retryConfig } = useMapConfig();
  if (configError) {
    return (
      <div className="map-view__state" role="alert">
        <p>Couldn't load the map settings.</p>
        <button type="button" className="toolbar-button" onClick={retryConfig}>
          Retry
        </button>
      </div>
    );
  }
  if (!config) return <div className="map-view__state">Loading map…</div>;
  return <LoadedMap libraryId={libraryId} config={config} onOpenPlace={onOpenPlace} />;
}

function LoadedMap({
  libraryId,
  config,
  onOpenPlace,
}: {
  libraryId: number;
  config: MapConfig;
  onOpenPlace: (bounds: MapBounds) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpenPlace);
  openRef.current = onOpenPlace;
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    setFailed(false);
    setEmpty(false);
    let disposed = false;
    let cleanup = () => {};

    createMap(element, config, { center: [0, 20], zoom: 1 })
      .then(({ map, maplibregl }) => {
        if (disposed) {
          map.remove();
          return;
        }
        const markers: { remove: () => void }[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sequence = 0;

        function draw(clusters: MapCluster[]) {
          for (const marker of markers.splice(0)) marker.remove();
          for (const cluster of clusters) {
            const onClick = () => {
              const b = cluster.bounds;
              const degenerate = b.west === b.east && b.south === b.north;
              if (cluster.count === 1 || degenerate || map.getZoom() >= OPEN_AT_ZOOM) {
                openRef.current(b);
              } else {
                map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 80, maxZoom: 18 });
              }
            };
            markers.push(
              new maplibregl.Marker({ element: pinElement(libraryId, cluster, onClick) })
                .setLngLat([cluster.lon, cluster.lat])
                .addTo(map),
            );
          }
        }

        async function refresh() {
          const mine = ++sequence;
          const b = map.getBounds();
          // Wider than the screen is the whole world: ask without a box.
          const wide = b.getEast() - b.getWest() >= 360;
          try {
            const result = await getMapClusters(
              libraryId,
              wide
                ? null
                : { west: b.getWest(), south: Math.max(-90, b.getSouth()), east: b.getEast(), north: Math.min(90, b.getNorth()) },
              Math.round(map.getZoom()) + 1,
            );
            if (disposed || mine !== sequence) return;
            setFailed(false);
            draw(result.clusters);
          } catch {
            if (!disposed && mine === sequence) setFailed(true);
          }
        }

        // First view: fit all of the library's located photos.
        async function start() {
          try {
            const overview = await getMapClusters(libraryId, null, 0);
            if (disposed) return;
            if (overview.total === 0) {
              setEmpty(true);
              return;
            }
            const all = overview.clusters.map((c) => c.bounds);
            map.fitBounds(
              [
                [Math.min(...all.map((x) => x.west)), Math.min(...all.map((x) => x.south))],
                [Math.max(...all.map((x) => x.east)), Math.max(...all.map((x) => x.north))],
              ],
              { padding: 80, maxZoom: 12, animate: false },
            );
          } catch {
            if (!disposed) setFailed(true);
            return;
          }
          map.on("moveend", () => {
            clearTimeout(timer);
            timer = setTimeout(() => void refresh(), 150);
          });
          void refresh();
        }
        void start();

        cleanup = () => {
          clearTimeout(timer);
          for (const marker of markers.splice(0)) marker.remove();
          map.remove();
        };
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [libraryId, config, attempt]);

  return (
    <div className="map-view" data-testid="map-view">
      <div ref={container} className="map-view__canvas" />
      <Attribution config={config} />
      {empty && <p className="map-view__note">No photos with a location.</p>}
      {failed && (
        <div className="map-view__state map-view__state--overlay" role="alert">
          <p>Couldn't load the map.</p>
          <button type="button" className="toolbar-button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
