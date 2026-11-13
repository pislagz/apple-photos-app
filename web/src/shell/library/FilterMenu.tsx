import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../icons";
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
    if (!open) return;
    function onPointerDown(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Focus the first item (or the checked filter) when the menu opens.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (!nested && checked ? checked : items?.[0])?.focus();
  }, [open, nested]);

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

  function trigger(name: Exclude<Section, null>, text: string, children: ReactNode) {
    const expanded = section === name;
    return (
      <>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={expanded}
          className="filter-menu__submenu-trigger"
          onClick={() => setSection(expanded ? null : name)}
        >
          <span className="filter-menu__check" aria-hidden="true" />
          {text}
          <span className="filter-menu__chevron" data-open={expanded} aria-hidden="true">
            <Icon name="chevron" size={12} />
          </span>
        </button>
        {expanded && (
          <div role="group" aria-label={text} className="filter-menu__submenu">
            {children}
          </div>
        )}
      </>
    );
  }

  const viewItems = viewOptions && (
    <>
      <button type="button" role="menuitem" disabled={!viewOptions.canZoomIn} onClick={viewOptions.onZoomIn}>
        <span className="filter-menu__check" aria-hidden="true" />
        Zoom In
      </button>
      <button type="button" role="menuitem" disabled={!viewOptions.canZoomOut} onClick={viewOptions.onZoomOut}>
        <span className="filter-menu__check" aria-hidden="true" />
        Zoom Out
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={viewOptions.wholePhotos}
        onClick={viewOptions.onToggleWholePhotos}
      >
        <span className="filter-menu__check" aria-hidden="true">
          {viewOptions.wholePhotos ? "✓" : ""}
        </span>
        Aspect Ratio Grid
      </button>
    </>
  );

  return (
    <div ref={rootRef} className={`filter-menu filter-menu--${variant}`}>
      <button
        ref={buttonRef}
        type="button"
        className={variant === "desktop" ? "toolbar-button" : "filter-menu__button"}
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
            <>
              {trigger("filter", "Filter", filterItems)}
              {viewItems && trigger("view", "View Options", viewItems)}
            </>
          ) : (
            filterItems
          )}
          {showItems}
        </div>
      )}
    </div>
  );
}
