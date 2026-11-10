import { createContext, useContext } from "react";

// What the Info panel needs to explain a missing place name: whether the admin
// agreed to "Map & place names", and whether the current user can change it.
export interface PlaceInfo {
  consent: boolean;
  canChangeSettings: boolean;
}

// Default: no explanation icon (used by components rendered without the app shell).
export const PlaceInfoContext = createContext<PlaceInfo>({ consent: true, canChangeSettings: false });

export function usePlaceInfo(): PlaceInfo {
  return useContext(PlaceInfoContext);
}

export const MAP_PLACE_NAMES_TEXT =
  "This app works fully offline. To show the map and place names, it can download OpenStreetMap map data and place-name data (GeoNames). Nothing about your photos is sent.";

// Settings deep link: /admin opens on this section.
export const MAP_PLACE_NAMES_ANCHOR = "map-place-names";
export const MAP_PLACE_NAMES_HREF = `/admin#${MAP_PLACE_NAMES_ANCHOR}`;
