import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../icons";

export type MobileGridNav = { title: string; backLabel: string; onBack: () => void };

// The one top bar every phone photo grid uses (#260): the Library's large
// date title over the photos, or a pushed grid's back button and title. The
// first row has the same height and padding in both, so Select (and the
// account button the shell floats beside it) sit at the same spot everywhere.
export default function MobileGridHeader({
  nav,
  scrim = 1,
  children,
  showSelect,
  actions,
  selectMode,
  onToggleSelect,
}: {
  nav?: MobileGridNav;
  // 0..1 strength of the #261 title scrim (Library only).
  scrim?: number;
  // The Library's date title block; unused when `nav` is given.
  children?: ReactNode;
  showSelect: boolean;
  // The Filter menu, left of Select (hidden while selecting).
  actions?: ReactNode;
  selectMode: boolean;
  onToggleSelect: () => void;
}) {
  const selectControl = (nav ? (
          <button type="button" className="mobile-library__select-button" onClick={onToggleSelect}>
            {selectMode ? "Cancel" : "Select"}
          </button>
        ) : selectMode ? (
          <button
            type="button"
            className="mobile-library__glass-button mobile-library__close-button"
            aria-label="Cancel"
            onClick={onToggleSelect}
          >
            <Icon name="close" />
          </button>
        ) : (
          <button type="button" className="mobile-library__glass-button mobile-library__select-button" onClick={onToggleSelect}>
            Select
          </button>
        ));
  return (
    <div
      className={nav ? "mobile-library__top-bar mobile-library__top-bar--nav" : "mobile-library__top-bar"}
      data-testid="top-bar"
      data-scrim={nav ? undefined : "true"}
      style={nav ? undefined : ({ "--title-scrim": scrim } as CSSProperties)}
    >
      {nav ? (
        <button type="button" className="mobile-screen__back mobile-library__back" onClick={nav.onBack}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          {nav.backLabel}
        </button>
      ) : (
        children
      )}
      {showSelect && actions ? (
        <div className="mobile-library__top-actions">
          {actions}
          {selectControl}
        </div>
      ) : (
        showSelect && selectControl
      )}
      {nav && <h1 className="mobile-screen__title mobile-library__nav-title">{nav.title}</h1>}
    </div>
  );
}
