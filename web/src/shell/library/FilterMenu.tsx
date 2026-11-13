import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { FILTER_OPTIONS, type LibraryFilterState } from "./useLibraryFilter";

// What the iPhone menu adds above "Show": View Options (zoom + aspect).
export interface ViewOptions {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  wholePhotos: boolean;
  onToggleWholePhotos: () => void;
}

type Section = "filter" | "view" | null;

// Only the filters the app supports (FILTER_OPTIONS), each with its row icon.
const FILTER_ICONS: Record<(typeof FILTER_OPTIONS)[number]["key"], IconName> = {
  all: "grid",
  favorites: "favorite",
  edited: "edited",
  photos: "original",
  videos: "video",
  screenshots: "screenshot",
  shared: "shared",
  "not-in-album": "notInAlbum",
};

// iOS-style tick for the leading column of the iPhone menu.
function Tick() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" className="filter-menu__tick">
      <path d="M4.5 10.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

// One popup menu for both layouts. Desktop ("Filter By") lists the choices
// directly; iPhone nests them under "Filter" and "View Options" like iOS.
export default function FilterMenu({
  state,
  variant,
  viewOptions,
  label = "Filter",
}: {
  state: LibraryFilterState;
  variant: "mobile" | "desktop";
  viewOptions?: ViewOptions;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const nested = variant === "mobile";

  function close(returnFocus: boolean) {
    setOpen(false);
    setSection(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    // The iPhone menu closes through its own backdrop (below), which also
    // swallows the tap so it cannot reach the grid. The desktop menu keeps
    // the document listeners below.
    if (!open || nested) return;
    function onPointerDown(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open, nested]);

  // Focus the first item (or the checked filter) when the menu opens.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (!nested && checked ? checked : items?.[0])?.focus();
  }, [open, nested]);

  // Moving into or out of a submenu card keeps focus inside the menu: the
  // card header when it opens, the row that opened it when it closes.
  const lastSection = useRef<Section>(null);
  useEffect(() => {
    if (!open || !nested) return;
    const menu = menuRef.current;
    if (!menu) return;
    if (section) {
      lastSection.current = section;
      menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    } else if (lastSection.current) {
      menu.querySelector<HTMLElement>(`[data-section="${lastSection.current}"]`)?.focus();
      lastSection.current = null;
    }
  }, [open, nested, section]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") close(false);
    if (next !== null) {
      event.preventDefault();
      items[next].focus();
    }
  }

  function choose(key: (typeof FILTER_OPTIONS)[number]["key"]) {
    state.setFilter(key);
    close(true);
  }

  const filterItems = (
    <>
      {FILTER_OPTIONS.map((option, i) => (
        <Fragment key={option.key}>
          {i === 1 && <div role="separator" className="filter-menu__separator" />}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={state.filter === option.key}
            onClick={() => choose(option.key)}
          >
            <span className="filter-menu__check" aria-hidden="true">
              {state.filter === option.key ? "✓" : ""}
            </span>
            {option.label}
          </button>
        </Fragment>
      ))}
    </>
  );

  const showItems = (
    <>
      <div role="separator" className="filter-menu__separator" />
      <div role="presentation" className="filter-menu__heading">
        Show
      </div>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={state.show.screenshots}
        onClick={() => state.setShow("screenshots", !state.show.screenshots)}
      >
        <span className="filter-menu__check" aria-hidden="true">
          {state.show.screenshots ? "✓" : ""}
        </span>
        Screenshots
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={state.show.shared}
        onClick={() => state.setShow("shared", !state.show.shared)}
      >
        <span className="filter-menu__check" aria-hidden="true">
          {state.show.shared ? "✓" : ""}
        </span>
        Shared with You
      </button>
    </>
  );

  // iPhone: two rows that open a card in place, like the iOS Photos menu.
  // The card swaps with the rows (header with a down chevron, then the items).
  function row(
    role: "menuitem" | "menuitemradio" | "menuitemcheckbox",
    text: string,
    icon: IconName | null,
    options: { checked?: boolean; disabled?: boolean; onClick: () => void },
  ) {
    const checkable = role !== "menuitem";
    return (
      <button
        key={text}
        type="button"
        role={role}
        aria-checked={checkable ? !!options.checked : undefined}
        disabled={options.disabled}
        className="filter-menu__row"
        onClick={options.onClick}
      >
        <span className="filter-menu__lead" aria-hidden="true">
          {options.checked ? <Tick /> : null}
        </span>
        {icon && (
          <span className="filter-menu__icon" aria-hidden="true">
            <Icon name={icon} size={22} />
          </span>
        )}
        <span className="filter-menu__text">{text}</span>
      </button>
    );
  }

  function sectionTrigger(name: Exclude<Section, null>, text: string) {
    return (
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={false}
        data-section={name}
        className="filter-menu__row filter-menu__row--parent"
        onClick={() => setSection(name)}
      >
        <span className="filter-menu__text">{text}</span>
        <span className="filter-menu__chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </button>
    );
  }

  function card(name: Exclude<Section, null>, text: string, children: ReactNode) {
    return (
      <div role="group" aria-label={text} className="filter-menu__card">
        <button
          type="button"
          role="menuitem"
          aria-expanded={true}
          data-section={name}
          className="filter-menu__row filter-menu__card-header"
          onClick={() => setSection(null)}
        >
          <span className="filter-menu__text">{text}</span>
          <span className="filter-menu__chevron" data-open="true" aria-hidden="true">
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <div role="separator" className="filter-menu__separator" />
        {children}
      </div>
    );
  }

  const mobileBody = (
    <>
      {section === null && (
        <>
          {sectionTrigger("filter", "Filter")}
          {viewOptions && sectionTrigger("view", "View Options")}
        </>
      )}
      {section === "filter" &&
        card(
          "filter",
          "Filter",
          FILTER_OPTIONS.map((option, i) => (
            <Fragment key={option.key}>
              {i === 1 && <div role="separator" className="filter-menu__separator" />}
              {row("menuitemradio", option.label, FILTER_ICONS[option.key], {
                checked: state.filter === option.key,
                onClick: () => choose(option.key),
              })}
            </Fragment>
          )),
        )}
      {section === "view" &&
        viewOptions &&
        card(
          "view",
          "View Options",
          <>
            {row("menuitem", "Zoom In", "zoomIn", { disabled: !viewOptions.canZoomIn, onClick: viewOptions.onZoomIn })}
            {row("menuitem", "Zoom Out", "zoomOut", { disabled: !viewOptions.canZoomOut, onClick: viewOptions.onZoomOut })}
            {row("menuitemcheckbox", "Aspect Ratio Grid", "aspect", {
              checked: viewOptions.wholePhotos,
              onClick: viewOptions.onToggleWholePhotos,
            })}
            <div role="separator" className="filter-menu__separator" />
            <div role="presentation" className="filter-menu__heading">
              Show:
            </div>
            {row("menuitemcheckbox", "Screenshots", "screenshot", {
              checked: state.show.screenshots,
              onClick: () => state.setShow("screenshots", !state.show.screenshots),
            })}
            {row("menuitemcheckbox", "Shared with You", "shared", {
              checked: state.show.shared,
              onClick: () => state.setShow("shared", !state.show.shared),
            })}
          </>,
        )}
    </>
  );

  return (
    <div ref={rootRef} className={`filter-menu filter-menu--${variant}`}>
      {open && nested && (
        // Covers the whole screen under the popup and the button: a tap
        // outside closes the menu and goes no further, so it never opens a photo.
        <div
          className="filter-menu__backdrop"
          data-testid="filter-menu-backdrop"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close(false);
          }}
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        className={variant === "desktop" ? "toolbar-button" : "filter-menu__button mobile-library__glass-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-active={state.active}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="filter" size={variant === "desktop" ? 16 : 22} filled={state.active} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="filter-menu__popup"
          onKeyDown={onMenuKeyDown}
        >
          {nested ? (
            mobileBody
          ) : (
            <>
              {filterItems}
              {showItems}
            </>
          )}
        </div>
      )}
    </div>
  );
}
