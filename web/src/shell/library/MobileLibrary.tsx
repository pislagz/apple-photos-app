import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { shareOrDownloadAssets } from "../viewer/download";
import MobileViewer from "../viewer/MobileViewer";
import { VIEWS, type ViewKey } from "./grouping";
import { buildRows } from "./rows";
import { useLibraryAssets } from "./useLibraryAssets";
import { usePinchColumns } from "./usePinchColumns";

const HEADER_ROW_HEIGHT = 32;
const DEFAULT_COLUMNS = 4;
// Keep fetching the next page well before the user reaches the physical
// bottom of what's loaded, since a page covers many virtual rows.
const LOAD_MORE_ROW_MARGIN = 3;

// P1.14: the mobile Library tab. Years/Months/Days/All Photos over
// `/api/libraries/{id}/assets`, never `/hidden` (P1.13) -- a hidden asset
// must not reach any of these views. Thumbnails only; the grid never
// requests an original.
export default function MobileLibrary({ libraryId }: { libraryId: number }) {
  const [view, setView] = useState<ViewKey>("years");
  const { items, loading, done, loadMore } = useLibraryAssets(libraryId);
  const { columns, touchHandlers } = usePinchColumns(DEFAULT_COLUMNS);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // P1.17 iPhone multi-select: tapping a cell in select mode toggles it
  // instead of opening the Viewer; outside select mode a tap still opens
  // the Viewer exactly as before.
  const openItem = useCallback(
    (item: AssetListItem) => {
      if (selectMode) {
        toggleSelected(item.id);
        return;
      }
      const index = items.indexOf(item);
      if (index !== -1) setOpenIndex(index);
    },
    [items, selectMode, toggleSelected],
  );

  async function handleShareSelection() {
    const toShare = items.filter((item) => selectedIds.has(item.id));
    if (toShare.length === 0) return;
    setSharing(true);
    try {
      await shareOrDownloadAssets(
        libraryId,
        toShare.map((item) => ({ id: item.id, filename: item.filename })),
      );
    } finally {
      setSharing(false);
    }
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  const rows = useMemo(() => buildRows(items, view, columns), [items, view, columns]);
  const cellSize = containerWidth > 0 ? containerWidth / columns : 0;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row.type === "header") return HEADER_ROW_HEIGHT;
      return row.type === "feature" ? cellSize * 2 : cellSize;
    },
    overscan: 6,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  // `virtualRows[0]` is the first row in the *overscanned* range, which
  // sits above the viewport while scrolling -- the pinned header needs the
  // topmost row actually scrolled to, found by scroll offset instead.
  const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
  const topmostRow = virtualRows.find((row) => row.start + row.size > scrollOffset) ?? virtualRows[0];
  const pinnedLabel = topmostRow ? rows[topmostRow.index]?.label ?? "" : "";

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last || loading || done) return;
    if (last.index >= rows.length - 1 - LOAD_MORE_ROW_MARGIN) loadMore();
  }, [virtualRows, rows.length, loading, done, loadMore]);

  return (
    <div className="mobile-library">
      {view !== "days" && (
        <div className="mobile-library__pinned-header" data-testid="pinned-header">
          {pinnedLabel}
        </div>
      )}
      <button
        type="button"
        className="mobile-library__select-button"
        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
      >
        {selectMode ? "Cancel" : "Select"}
      </button>
      <div className="mobile-library__view-switch" role="tablist" aria-label="Library zoom">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className="mobile-library__view-switch-item"
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        ref={scrollRef}
        className="mobile-library__scroll"
        data-testid="library-scroll"
        style={{ touchAction: "pan-y" }}
        {...touchHandlers}
      >
        {items.length === 0 && done ? (
          <p className="mobile-library__empty">No photos yet.</p>
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
                // The pinned overlay above already shows the topmost
                // group's label; rendering it again here would duplicate
                // the date line right under the overlay.
                const isPinnedRow = topmostRow !== undefined && virtualRow.index === topmostRow.index;
                return (
                  <div key={row.key} style={style} className="mobile-library__row-header">
                    {isPinnedRow ? null : row.label}
                  </div>
                );
              }
              if (row.type === "feature") {
                const hero = row.items[0];
                return (
                  <div key={row.key} style={style} className="mobile-library__row-feature">
                    <img
                      src={`/api/libraries/${libraryId}/thumb/${hero.id}?size=grid2x`}
                      alt={hero.filename ?? ""}
                      loading="lazy"
                      className="mobile-library__feature-image"
                      onClick={() => openItem(hero)}
                    />
                    <div className="mobile-library__feature-caption">{row.label}</div>
                    {selectMode && (
                      <span
                        className="mobile-library__select-badge"
                        data-selected={selectedIds.has(hero.id)}
                        aria-label={selectedIds.has(hero.id) ? "Selected" : "Select"}
                      />
                    )}
                  </div>
                );
              }
              return (
                <div key={row.key} style={{ ...style, display: "flex" }} className="mobile-library__row-grid">
                  {row.items.map((item) => (
                    <div
                      key={item.id}
                      className="mobile-library__cell-wrap"
                      style={{ width: cellSize, height: cellSize }}
                    >
                      <img
                        src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`}
                        alt={item.filename ?? ""}
                        loading="lazy"
                        className="mobile-library__cell"
                        style={{ width: cellSize, height: cellSize }}
                        onClick={() => openItem(item)}
                      />
                      {selectMode && (
                        <span
                          className="mobile-library__select-badge"
                          data-selected={selectedIds.has(item.id)}
                          aria-label={selectedIds.has(item.id) ? "Selected" : "Select"}
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selectMode && (
        <div className="mobile-library__select-bar" data-testid="select-bar">
          <span className="mobile-library__select-count">
            {selectedIds.size > 0 ? `${selectedIds.size} Selected` : "Select Items"}
          </span>
          <button
            type="button"
            onClick={handleShareSelection}
            disabled={selectedIds.size === 0 || sharing}
          >
            Share
          </button>
        </div>
      )}
      {openIndex !== null && (
        <MobileViewer
          libraryId={libraryId}
          items={items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
