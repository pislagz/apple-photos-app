import { createContext, useContext } from "react";

// What the viewer's ••• menu can ask the shell to do (#514). Absent (the
// Hidden view, tests) the rows that need it are left out.
export interface ViewerActions {
  showInLibrary?: (assetId: string) => void;
  showOnMap?: (latitude: number, longitude: number) => void;
}

export const ViewerActionsContext = createContext<ViewerActions>({});

export function useViewerActions(): ViewerActions {
  return useContext(ViewerActionsContext);
}
