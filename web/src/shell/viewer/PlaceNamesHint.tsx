import { useId, useState } from "react";
import { MAP_PLACE_NAMES_HREF, usePlaceInfo } from "../PlaceInfoContext";

// A small "i" after coordinates shown in place of a name when the admin has not
// agreed to "Map & place names". Hover or focus shows the text on desktop; a tap
// (click) toggles it on the iPhone. A real button, so the keyboard reaches it.
export function PlaceNamesHint() {
  const { consent, canChangeSettings } = usePlaceInfo();
  const [pinned, setPinned] = useState(false);
  const id = useId();
  if (consent) return null;
  return (
    <span className="place-hint">
      <button
        type="button"
        className="place-hint__button"
        aria-label="Why is there no place name?"
        aria-expanded={pinned}
        aria-describedby={id}
        onClick={() => setPinned((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPinned(false);
        }}
      >
        i
      </button>
      <span id={id} role="tooltip" className={pinned ? "place-hint__tip place-hint__tip--open" : "place-hint__tip"}>
        Place names are off because you haven't agreed to use OpenStreetMap data.{" "}
        {canChangeSettings ? (
          <>
            You can change this in <a href={MAP_PLACE_NAMES_HREF}>Settings</a>.
          </>
        ) : (
          "An admin can change this in Settings."
        )}
      </span>
    </span>
  );
}
