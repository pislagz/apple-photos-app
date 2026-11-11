import { PLACE_PREFIX } from "../../api";
import { Icon } from "../icons";
import MobileLibrary from "../library/MobileLibrary";
import MapView, { boundsParam } from "./MapView";

// P2.3: More > Places. `/places` is the map; `/places/<w,s,e,n>` is the
// photos under one pin, in the regular All Photos grid and Viewer.
export default function PlacesScreen({
  libraryId,
  bbox,
  onNavigate,
}: {
  libraryId: number;
  bbox?: string;
  onNavigate: (path: string) => void;
}) {
  if (bbox) {
    return (
      <div className="mobile-screen">
        <div className="mobile-screen__album-grid">
          <MobileLibrary
            key={bbox}
            libraryId={libraryId}
            album={`${PLACE_PREFIX}${bbox}`}
            nav={{ title: "Photos here", backLabel: "Places", onBack: () => onNavigate("/places") }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={() => onNavigate("/more")}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          More
        </button>
        <h1 className="mobile-screen__title">Places</h1>
      </header>
      <div className="mobile-screen__map">
        <MapView
          libraryId={libraryId}
          onOpenPlace={(b) => onNavigate(`/places/${encodeURIComponent(boundsParam(b))}`)}
        />
      </div>
    </div>
  );
}
