import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { Icon } from "../icons";
import DesktopViewer from "../viewer/DesktopViewer";
import { VIEWS, type ViewKey } from "./grouping";
import { buildRows } from "./rows";
import { useLibraryAssets } from "./useLibraryAssets";

const HEADER_ROW_HEIGHT = 28;
// Desktop toolbar's zoom slider/`+`/`-`: more, smaller columns at the low
// end (`grid` thumbs), fewer, larger columns at the high end (`grid2x`), per
// docs/TASKS.md P1.15 ("Zoom changes the thumb size requested").
const ZOOM_STEPS: { columns: number; thumbSize: "grid" | "grid2x" }[] = [
  { columns: 10, thumbSize: "grid" },
  { columns: 8, thumbSize: "grid" },
  { columns: 6, thumbSize: "grid" },
  { columns: 4, thumbSize: "grid2x" },
  { columns: 3, thumbSize: "grid2x" },
  { columns: 2, thumbSize: "grid2x" },
];
const DEFAULT_ZOOM_INDEX = 2;
const MAX_ZOOM_INDEX = ZOOM_STEPS.length - 1;
// Years/Months/All Photos only -- Days (the iOS 17 feature-row layout) is
// mobile-only per docs/TASKS.md P1.15.
const DESKTOP_VIEWS = VIEWS.filter((item) => item.key !== "days");
const LOAD_MORE_ROW_MARGIN = 3;

// Short form for the Sequoia-style date-range title (sequoia-library-grid.png:
// "Apr 13, 2021 – Jun 11, 2024" overlaid on the first row). `date` is a naive
// UTC-ish ISO string, same convention as grouping.ts's `formatGroupLabel`.
function shortDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// Phase 1 download is one file at a time (CLAUDE.md); a multi-selection
// just triggers that many browser downloads in sequence instead of a zip
// (Phase 3). This never touches `/original` on its own -- only an explicit
// click does.
function downloadSelection(libraryId: number, ids: Iterable<string>) {
  for (const id of ids) {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId}/original/${id}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

// P1.15: the desktop Library grid. Toolbar (Years/Months/All Photos, zoom,
// search UI-only, download, Info toggle, selection count), a virtualized
// grid with inline date headers, hover heart/duration, and
// click/modifier/shift/drag selection. Like the mobile Library (P1.14),
// this only ever pages `/assets` -- never `/hidden` -- so a hidden asset
// (P1.13) can't reach any view or ⌘A. Cells request thumbnails only; a
// download is the only thing that may hit `/original`.
export default function DesktopLibrary({ libraryId }: { libraryId: number }) {
  const [view, setView] = useState<ViewKey>("years");
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [squareMode, setSquareMode] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const anchorIdRef = useRef<string | null>(null);
  // Holds the arrow-key target index while it is still past the loaded
  // items, so the reconciliation effect below can catch focus up once
  // `loadMore` delivers the page that contains it.
  const desiredIndexRef = useRef<number | null>(null);

  const { items, loading, done, loadMore, loadAll } = useLibraryAssets(libraryId);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const columns = ZOOM_STEPS[zoomIndex].columns;
  const thumbSize = ZOOM_STEPS[zoomIndex].thumbSize;
  const rows = useMemo(() => buildRows(items, view, columns), [items, view, columns]);
  const cellSize = containerWidth > 0 ? containerWidth / columns : 0;

  // Items arrive sorted descending by date (grouping.ts), so the first and
  // last loaded items are the newest and oldest seen so far.
  const dateRangeLabel = useMemo(() => {
    const dated = items.filter((item): item is AssetListItem & { date: string } => Boolean(item.date));
    if (dated.length === 0) return "";
    const newest = shortDate(dated[0].date);
    const oldest = shortDate(dated[dated.length - 1].date);
    return newest === oldest ? newest : `${oldest} – ${newest}`;
  }, [items]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === "header" ? HEADER_ROW_HEIGHT : cellSize),
    overscan: 6,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last || loading || done) return;
    if (last.index >= rows.length - 1 - LOAD_MORE_ROW_MARGIN) loadMore();
  }, [virtualRows, rows.length, loading, done, loadMore]);

  // Keyboard/click focus has to stay on-screen: the virtualizer only mounts
  // rows near the viewport, so moving focus by state alone (as selection
  // does) leaves the newly-focused cell unmounted if it was outside the
  // overscan window.
  useEffect(() => {
    if (!focusedId) return;
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.id === focusedId));
    if (rowIndex !== -1) rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [focusedId, rows, rowVirtualizer]);

  // ⌘F focuses search from anywhere in the component, so it has to be a
  // window listener rather than living on the grid's own key handler below.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  const selectSingle = useCallback((id: string) => {
    setSelected(new Set([id]));
    anchorIdRef.current = id;
    setFocusedId(id);
  }, []);

  // Reconciles an arrow-key target that was past the loaded items at the
  // time of the keypress: once the requested page arrives, catch focus up
  // to it (loading another page first if it still isn't far enough).
  useEffect(() => {
    const desired = desiredIndexRef.current;
    if (desired === null) return;
    if (desired < items.length) {
      selectSingle(items[desired].id);
      desiredIndexRef.current = null;
    } else if (!done && !loading) {
      loadMore();
    } else {
      desiredIndexRef.current = null;
    }
  }, [items, done, loading, loadMore, selectSingle]);

  const handleCellClick = useCallback(
    (event: React.MouseEvent, item: AssetListItem, index: number) => {
      if (event.shiftKey && anchorIdRef.current) {
        const anchorIndex = items.findIndex((candidate) => candidate.id === anchorIdRef.current);
        if (anchorIndex !== -1) {
          const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
          setSelected(new Set(items.slice(lo, hi + 1).map((candidate) => candidate.id)));
          setFocusedId(item.id);
          return;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
        anchorIdRef.current = item.id;
        setFocusedId(item.id);
        return;
      }
      selectSingle(item.id);
    },
    [items, selectSingle],
  );

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Opens the Viewer on this id, at its position in `items` -- the current
  // Library view's own array, never `/hidden` (P1.13), so the Viewer can
  // only ever page through what the grid itself shows.
  const handleOpen = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index !== -1) setViewerIndex(index);
    },
    [items],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        loadAll().then((all) => setSelected(new Set(all.map((item) => item.id))));
        return;
      }
      if (event.key === "Escape") {
        setSelected(new Set());
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoomIndex((previous) => Math.min(MAX_ZOOM_INDEX, previous + 1));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoomIndex((previous) => Math.max(0, previous - 1));
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (focusedId) handleOpen(focusedId);
        return;
      }
      const deltas: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: columns,
        ArrowUp: -columns,
      };
      const delta = deltas[event.key];
      if (delta === undefined || items.length === 0) return;
      event.preventDefault();
      const currentIndex = focusedId ? items.findIndex((item) => item.id === focusedId) : -1;
      const base = desiredIndexRef.current ?? (currentIndex === -1 ? 0 : currentIndex);
      const desired = Math.max(0, base + delta);
      const nextIndex = Math.min(items.length - 1, desired);
      if (desired > nextIndex && !done) {
        desiredIndexRef.current = desired;
        loadMore();
      } else {
        desiredIndexRef.current = null;
      }
      selectSingle(items[nextIndex].id);
    },
    [items, columns, focusedId, handleOpen, selectSingle, done, loadMore, loadAll],
  );

  const setCellRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) cellRefs.current.set(id, element);
    else cellRefs.current.delete(id);
  }, []);

  // Drag-select: mousedown on the grid background (not a cell, no
  // modifier) starts a rubber-band; cells whose rendered rect overlaps the
  // drag rect on mouseup become the selection. Only presently-mounted
  // (virtualized-visible) cells can be hit, same as a real click. The rect
  // lives in a ref, not state, so `onUp` always reads the latest bounds
  // instead of the value captured when this effect was set up.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleGridMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if ((event.target as HTMLElement).closest("[data-asset-id]")) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragRectRef.current = { left: event.clientX, top: event.clientY, width: 0, height: 0 };
    setDragActive(true);
  }, []);

  useEffect(() => {
    if (!dragActive) return;
    function onMove(event: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      dragRectRef.current = {
        left: Math.min(start.x, event.clientX),
        top: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
    }
    function onUp() {
      const rect = dragRectRef.current;
      dragStartRef.current = null;
      dragRectRef.current = null;
      setDragActive(false);
      if (!rect || (rect.width < 2 && rect.height < 2)) return;
      const hits = new Set<string>();
      for (const [id, element] of cellRefs.current) {
        const box = element.getBoundingClientRect();
        const overlaps =
          box.left < rect.left + rect.width &&
          box.left + box.width > rect.left &&
          box.top < rect.top + rect.height &&
          box.top + box.height > rect.top;
        if (overlaps) hits.add(id);
      }
      if (hits.size > 0) setSelected(hits);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragActive]);

  const handleDownload = useCallback(() => {
    if (selected.size === 0) return;
    downloadSelection(libraryId, selected);
  }, [libraryId, selected]);

  return (
    <div className="desktop-library" data-testid="desktop-library">
      <div className="desktop-library__toolbar" data-testid="desktop-library-toolbar">
        <div className="desktop-library__zoom-slider">
          <Icon name="grid" size={14} />
          <input
            type="range"
            aria-label="Zoom"
            min={0}
            max={MAX_ZOOM_INDEX}
            value={zoomIndex}
            onChange={(event) => setZoomIndex(Number(event.target.value))}
          />
        </div>
        <div className="desktop-library__spacer" />
        <div role="tablist" aria-label="Library zoom" className="segmented-control">
          {DESKTOP_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view === item.key}
              className="segmented-control__item"
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={!squareMode}
          onClick={() => setSquareMode((value) => !value)}
          title={squareMode ? "Square" : "Aspect"}
        >
          <Icon name="rotate" size={16} />
          <span className="sr-only">{squareMode ? "Square" : "Aspect"}</span>
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={handleDownload}
          disabled={selected.size === 0}
          title="Download"
        >
          <Icon name="download" size={16} />
          <span className="sr-only">Download</span>
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={infoOpen}
          onClick={() => setInfoOpen((value) => !value)}
          title="Info"
        >
          <Icon name="info" size={16} />
          <span className="sr-only">Info</span>
        </button>
        <span className="desktop-library__selection-count" data-testid="selection-count">
          {selected.size > 0 ? `${selected.size} selected` : ""}
        </span>
        <div className="search-field">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search"
            placeholder="Search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>
      </div>
      <div
        ref={scrollRef}
        className="desktop-library__grid"
        data-testid="desktop-library-grid"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onMouseDown={handleGridMouseDown}
      >
        {dateRangeLabel && <div className="desktop-library__date-range">{dateRangeLabel}</div>}
        {items.length === 0 && done ? (
          <p className="desktop-library__empty">No photos yet.</p>
        ) : (
          <div style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const style: CSSProperties = {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              };
              if (row.type === "header") {
                return (
                  <div key={row.key} style={style} className="desktop-library__row-header">
                    {row.label}
                  </div>
                );
              }
              return (
                <div
                  key={row.key}
                  style={{ ...style, display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)` }}
                  className="desktop-library__row-grid"
                >
                  {row.items.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        ref={(element) => setCellRef(item.id, element)}
                        data-asset-id={item.id}
                        data-testid="library-cell"
                        data-selected={selected.has(item.id)}
                        className="desktop-library__cell"
                        style={{ height: cellSize }}
                        onClick={(event) => handleCellClick(event, item, index)}
                        onDoubleClick={() => handleOpen(item.id)}
                      >
                        <img
                          src={`/api/libraries/${libraryId}/thumb/${item.id}?size=${thumbSize}`}
                          alt={item.filename ?? ""}
                          loading="lazy"
                          className="desktop-library__thumb"
                          style={{ objectFit: squareMode ? "cover" : "contain" }}
                        />
                        {item.favorite && (
                          <span className="desktop-library__heart" aria-label="Favorite">
                            ♥
                          </span>
                        )}
                        {item.is_video && (
                          <span className="desktop-library__duration">{formatDuration(item.duration)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {viewerIndex !== null && (
        <DesktopViewer
          libraryId={libraryId}
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
