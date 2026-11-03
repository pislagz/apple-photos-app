import type { LibrarySummary } from "../../api";
import { Icon } from "../icons";
import LibrarySwitcher from "../LibrarySwitcher";
import { MEDIA_TYPES } from "./mediaTypes";

// #125, tracker R1: the phone "More" tab -- People & Pets, Places, Media
// Types, and Utilities (Hidden only; no Recently Deleted or Duplicates,
// this app is view-only). Tracker R21: the library switcher sits at the
// very bottom since switching libraries is rare -- same placement as the
// bottom of the Mac sidebar (#90).
export default function MoreScreen({
  libraries,
  activeLibraryId,
  onActiveLibraryChange,
  onNavigate,
}: {
  libraries: LibrarySummary[];
  activeLibraryId: number | undefined;
  onActiveLibraryChange: (id: number) => void;
  onNavigate: (path: "/people" | "/places" | `/media/${string}` | "/hidden") => void;
}) {
  return (
    <div className="more-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">More</h1>
      </header>
      <div className="more-screen__body">
        <ul className="more-screen__group">
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/people")}>
              <Icon name="people" className="more-screen__icon" />
              People & Pets
            </button>
          </li>
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/places")}>
              <Icon name="map" className="more-screen__icon" />
              Places
            </button>
          </li>
        </ul>
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Media Types</li>
          {MEDIA_TYPES.map((type) => (
            <li key={type.slug}>
              <button
                type="button"
                className="more-screen__item"
                onClick={() => onNavigate(`/media/${type.slug}`)}
              >
                <Icon name={type.icon} className="more-screen__icon" />
                {type.label}
              </button>
            </li>
          ))}
        </ul>
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Utilities</li>
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/hidden")}>
              <Icon name="hidden" className="more-screen__icon" />
              Hidden
            </button>
          </li>
        </ul>
      </div>
      <LibrarySwitcher
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onChange={onActiveLibraryChange}
        className="more-screen__library-switcher"
      />
    </div>
  );
}
