import { useEffect, useRef } from "react";
import Attribution from "./Attribution";
import { createMap } from "./createMap";
import { useMapConfig } from "./useMapConfig";

// P2.3: the Info panel's small map, on the same `Map tiles` setting. It is
// read-only: no dragging, no way to move the pin.
export default function MiniMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const { config } = useMapConfig();
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || !config) return;
    let disposed = false;
    let dispose = () => {};
    createMap(element, config, {
      center: [longitude, latitude],
      zoom: 13,
      interactive: false,
    })
      .then(({ map, maplibregl }) => {
        if (disposed) {
          map.remove();
          return;
        }
        const pin = document.createElement("div");
        pin.className = "map-minipin";
        const marker = new maplibregl.Marker({ element: pin }).setLngLat([longitude, latitude]).addTo(map);
        dispose = () => {
          marker.remove();
          map.remove();
        };
      })
      .catch(() => {});
    return () => {
      disposed = true;
      dispose();
    };
  }, [config, latitude, longitude]);

  return (
    <div className="map-mini" data-testid="mini-map">
      <div ref={container} className="map-mini__canvas" />
      {config && <Attribution config={config} />}
    </div>
  );
}
