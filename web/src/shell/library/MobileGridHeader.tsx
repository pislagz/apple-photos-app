import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../icons";

export type MobileGridNav = { title: string; backLabel: string; onBack: () => void };

// The one top bar every phone photo grid uses (#260): the Library's large
// date title over the photos, or a pushed grid's back button and title. The
// first row has the same height and padding in both, so Select (and the
// account button the shell floats beside it) sit at the same spot everywhere.
export default function MobileGridHeader({
  nav,
  libraryTitle,
  scrim,
  showSelect,
  selectMode,
  onToggleSelect,
}: {
  nav?: MobileGridNav;
  // The Library's title block (large title + date, or the pill); #209.
  libraryTitle?: ReactNode;
  // 0..1 strength of the Library's scrim; it fades in on scroll (#261).
  scrim?: number;
  showSelect: boolean;
  selectMode: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div
      className={nav ? "mobile-library__top-bar mobile-library__top-bar--nav" : "mobile-library__top-bar"}
      data-testid="top-bar"
      data-scrim={nav ? undefined : "true"}
      style={nav || scrim === undefined ? undefined : ({ "--title-scrim": scrim } as CSSProperties)}
    >
      {nav ? (
        <button type="button" className="mobile-screen__back mobile-library__back" onClick={nav.onBack}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          {nav.backLabel}
        </button>
      ) : (
        libraryTitle
      )}
      {showSelect && (
        <button type="button" className="mobile-library__select-button" onClick={onToggleSelect}>
          {selectMode ? "Cancel" : "Select"}
        </button>
      )}
      {nav && <h1 className="mobile-screen__title mobile-library__nav-title">{nav.title}</h1>}
    </div>
  );
}
