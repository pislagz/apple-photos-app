import HeicFallbackModal from "./HeicFallbackModal";
import { CheckBadge, TileOverlays } from "./TileOverlays";
import MobileGridHeader, { type MobileGridNav } from "./MobileGridHeader";
import ZipStatus from "./ZipStatus";
import { Icon } from "../icons";
import { selectionCountLabel } from "./selectionText";
import { selectionHasHeic, useZipDownload } from "./zipDownload";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { assetAlt } from "../assetAlt";
import { albumMessages } from "./albumText";
import { downloadSingleAsset, shareOrDownloadAssets } from "../viewer/download";
import MobileViewer from "../viewer/MobileViewer";
import { VIEWS, type ViewKey } from "./grouping";
import { buildRows, buildTileRows, type LibraryRow } from "./rows";
import SummaryTile from "./SummaryTile";
import { useDeepLinkOpen } from "./useDeepLinkOpen";
import { useLibraryAssets } from "./useLibraryAssets";
import { useLibrarySummary } from "./useLibrarySummary";
import { anchoredScrollTop, assetIdAtPoint, findRowIndexByAsset, type PinchAnchor } from "./pinchAnchor";
import DateTitle from "./DateTitle";
import { phoneTitle, titleScrimProgress } from "./libraryTitle";
import { usePinchColumns } from "./usePinchColumns";
import FadeImage from "./FadeImage";
import { useSlidingPill } from "./useSlidingPill";

const HEADER_ROW_HEIGHT = 32;
const DEFAULT_COLUMNS = 4;
// Years/Months tiles are full-width cards, sized off the container alone --
// independent of pinch-zoom's `columns`, which only ever applies to Days
// and All Photos.
const TILE_ASPECT_RATIO = 0.66;
// Keep fetching the next page well before the user reaches the physical
// bottom of what's loaded, since a page covers many virtual rows.
const LOAD_MORE_ROW_MARGIN = 3;

// P1.14: the mobile Library tab. Years/Months/Days/All Photos over
// `/api/libraries/{id}/assets`, never `/hidden` (P1.13) -- a hidden asset
// must not reach any of these views. Thumbnails only; the grid never
// requests an original.
export default function MobileLibrary({
  libraryId,
  initialAssetId,
  onInitialAssetOpened,
  resetSignal = 0,
  album,
  nav,
}: {
  libraryId: number;
  initialAssetId?: string;
  onInitialAssetOpened?: () => void;
  // Bumped by the shell when the already-active Library tab is tapped again.
  resetSignal?: number;
  // P2.1: an album's id (or `smart:<slug>`). Lists only that album, as one
  // All Photos grid -- no Years/Months/Days switch, no summary.
  album?: string;
  // A pushed grid (an album, a media type, a person, a place): back button
  // and title in the grid's own top bar instead of a header above it.
  nav?: MobileGridNav;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewKey>(album ? "all" : "years");
  // Set right before drilling Months -> Days (#126): anchors the Days/All
  // Photos feed's first page at that month instead of the top of the whole
  // library. `/assets`'s `to` bound is a string compare on the local-day
  // column, so "-31" is always a safe upper bound regardless of the real
  // month length.
  const [daysAnchor, setDaysAnchor] = useState<string | null>(null);
  const { items, loading, done, error: assetsError, retry: retryAssets, loadMore } = useLibraryAssets(
    libraryId,
    daysAnchor,
    "all",
    album ?? null,
  );
  const { summary, error: summaryError, retry: retrySummary } = useLibrarySummary(libraryId, !album);
  const pinchAnchor = useRef<PinchAnchor | null>(null);
  const { columns, touchHandlers } = usePinchColumns(DEFAULT_COLUMNS, (midpoint) => {
    // #93: remember the asset under the fingers; the layout effect below
    // scrolls it back into place once the new column count has reflowed.
    const element = scrollRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const viewportY = midpoint.clientY - rect.top;
    const y = element.scrollTop + viewportY;
    const row = rowVirtualizer.getVirtualItems().find((r) => r.start <= y && y < r.start + r.size);
    const assetId = assetIdAtPoint(row ? rows[row.index] : undefined, midpoint.clientX - rect.left, cellSize);
    if (row && assetId) pinchAnchor.current = { assetId, rowFraction: (y - row.start) / row.size, viewportY };
  });
  // #146: back to the newest photos -- drop the Month -> Days anchor and
  // scroll to the top. Re-selecting a zoom tab or the Library tab does this.
  const backToNewest = useCallback(() => {
    setDaysAnchor(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);
  const lastResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (lastResetSignal.current === resetSignal) return;
    lastResetSignal.current = resetSignal;
    backToNewest();
  }, [resetSignal, backToNewest]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Set right before drilling Years -> Months, so the scroll effect below
  // can land on the tapped year's own tile once Months' rows exist.
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const isTileView = view === "years" || view === "months";

  useDeepLinkOpen(initialAssetId, items, loading, done, loadMore, setOpenIndex, onInitialAssetOpened);
  const [selectMode, setSelectMode] = useState(false);
  const segmentRef = useSlidingPill<HTMLDivElement>(view, !selectMode && !album);
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
  // instead of navigating. Outside select mode, a tap opens the Viewer --
  // Years/Months tiles drill down instead, via `openTile` below (R3, #126).
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

  // A Year tile scrolls Months to that year; a Month tile anchors Days to
  // that month (#126). Neither ever opens the Viewer.
  const openTile = useCallback(
    (bucketKey: string) => {
      if (view === "years") {
        setPendingScrollKey(bucketKey);
        setView("months");
        return;
      }
      setDaysAnchor(`${bucketKey}-31`);
      setView("days");
    },
    [view],
  );

  async function handleShareSelection() {
    const toShare = items.filter((item) => selectedIds.has(item.id));
    if (toShare.length === 0) return;
    setSharing(true);
    try {
      await shareOrDownloadAssets(
        libraryId,
        toShare.map((item) => ({ id: item.id, filename: item.filename, original_filename: item.original_filename })),
      );
    } finally {
      setSharing(false);
    }
  }

  const zip = useZipDownload(libraryId);
  const selectionHasHeicPhoto = useMemo(() => selectionHasHeic(items, selectedIds), [items, selectedIds]);

  // One selected item downloads as the plain file; 2+ keep the archive flow.
  async function handleDownloadSelection() {
    const ids = [...selectedIds];
    if (ids.length !== 1) {
      void zip.start(ids, { forceNative: !selectionHasHeicPhoto });
      return;
    }
    const item = items.find((candidate) => candidate.id === ids[0]);
    await downloadSingleAsset(libraryId, ids[0], { asJpeg: zip.jpeg && selectionHasHeicPhoto && !item?.is_video });
  }

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

  // #91: Years/Months tiles come straight from `/summary`, not from
  // `buildRows` over the cursor-paged `items` -- so they render instantly
  // without paging through the whole library, and a `summary` still
  // loading renders zero rows rather than a stale grid.
  const rows = useMemo<LibraryRow[]>(() => {
    if (view === "years") return summary ? buildTileRows(summary.years, "years") : [];
    if (view === "months") return summary ? buildTileRows(summary.months, "months") : [];
    return buildRows(items, view, columns);
  }, [view, summary, items, columns]);
  const cellSize = containerWidth > 0 ? containerWidth / columns : 0;
  const tileHeight = containerWidth > 0 ? containerWidth * TILE_ASPECT_RATIO : 0;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row.type === "header") return HEADER_ROW_HEIGHT;
      if (row.type === "tile") return tileHeight;
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
  const topRow = topmostRow ? rows[topmostRow.index] : undefined;
  const topDate = topRow && (topRow.type === "grid" || topRow.type === "feature") ? topRow.items[0]?.date : undefined;
  const { subtitle: pinnedSubtitle, pill: pinnedPill } = phoneTitle(columns, topDate || undefined);

  useEffect(() => {
    // Years/Months never page -- `/summary` already carries every bucket.
    if (isTileView) return;
    const last = virtualRows[virtualRows.length - 1];
    if (!last || loading || done) return;
    if (last.index >= rows.length - 1 - LOAD_MORE_ROW_MARGIN) loadMore();
  }, [isTileView, virtualRows, rows.length, loading, done, loadMore]);

  useLayoutEffect(() => {
    const anchor = pinchAnchor.current;
    pinchAnchor.current = null;
    const element = scrollRef.current;
    if (!anchor || !element) return;
    const index = findRowIndexByAsset(rows, anchor.assetId);
    const measured = rowVirtualizer.measurementsCache[index];
    if (index === -1 || !measured) return;
    const top = anchoredScrollTop(anchor, measured.start, measured.size, rowVirtualizer.getTotalSize(), element.clientHeight);
    rowVirtualizer.scrollToOffset(top);
    // Only columns changing should re-anchor.
  }, [columns]);

  // Lands Months scrolled to the year tile that was tapped, not back at the
  // top -- see `openTile` above. A month's own key ("2022-01") always
  // starts with its year's key ("2022").
  useEffect(() => {
    if (!pendingScrollKey) return;
    const rowIndex = rows.findIndex((row) => row.type === "tile" && row.key.startsWith(pendingScrollKey));
    if (rowIndex !== -1) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: "start" });
      setPendingScrollKey(null);
    }
  }, [pendingScrollKey, rows, rowVirtualizer]);

  const showSummaryError = isTileView && summaryError;
  // #147: Days / All Photos page `/assets`; a failed first page is an error, not an empty library.
  const showAssetsError = !isTileView && assetsError && items.length === 0;
  const isEmpty = isTileView ? summary !== null && rows.length === 0 : items.length === 0 && done;

  return (
    <div className="mobile-library">
      {(nav || view === "all" || !isTileView) && (
        // One flex row so the title can never sit under Select: the title
        // shrinks and ellipsizes, Select keeps its natural width. The scrim is
        // always on: Days has the white Select over a bright hero photo too (#176).
        // In All Photos the scrim fades in with the first bit of scroll (#261).
        <MobileGridHeader
          nav={nav}
          scrim={view === "all" ? titleScrimProgress(scrollOffset) : 1}
          libraryTitle={
            view === "all" ? (
              <div className="mobile-library__title-block">
                {pinnedPill ? (
                  <DateTitle text={pinnedPill} className="mobile-library__pill" testId="pinned-header" />
                ) : (
                  <>
                    <div className="mobile-library__large-title">Library</div>
                    <DateTitle text={pinnedSubtitle} className="mobile-library__subtitle" testId="pinned-header" />
                  </>
                )}
              </div>
            ) : undefined
          }
          showSelect={!isTileView}
          selectMode={selectMode}
          onToggleSelect={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        />
      )}
      {!selectMode && !album && (
        <div ref={segmentRef} className="mobile-library__view-switch" role="tablist" aria-label="Library zoom">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view === item.key}
              className="mobile-library__view-switch-item"
              onClick={() => {
                // A direct tab tap is not a drill-down (`openTile` below) --
                // clear any stale Month -> Days anchor so tapping Days here
                // starts at the top of the library, not back at the last
                // drilled-into month.
                backToNewest();
                setView(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scrollRef}
        className="mobile-library__scroll"
        data-testid="library-scroll"
        style={{ touchAction: "pan-y" }}
        {...touchHandlers}
      >
        {showSummaryError || showAssetsError ? (
          <div className="mobile-library__empty" role="alert">
            <p>{albumMessages(album).error}</p>
            <button
              type="button"
              className="mobile-library__retry"
              onClick={showSummaryError ? retrySummary : retryAssets}
            >
              Retry
            </button>
          </div>
        ) : isEmpty ? (
          <p className="mobile-library__empty">{albumMessages(album).empty}</p>
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
              if (row.type === "tile") {
                return (
                  <div key={row.key} style={style}>
                    <SummaryTile
                      libraryId={libraryId}
                      label={row.label}
                      count={row.count}
                      keyAssetIds={row.keyAssetIds}
                      onOpen={() => openTile(row.key)}
                    />
                  </div>
                );
              }
              if (row.type === "feature") {
                const hero = row.items[0];
                return (
                  <div key={row.key} style={style} className="mobile-library__row-feature" data-selected={selectMode ? selectedIds.has(hero.id) : undefined}>
                    <FadeImage
                      src={`/api/libraries/${libraryId}/thumb/${hero.id}?size=grid2x`}
                      alt={assetAlt(hero)}
                      loading="lazy"
                      className="mobile-library__feature-image"
                      onClick={() => openItem(hero)}
                    />
                    <div className="mobile-library__feature-caption">{row.label}</div>
                    {selectMode && <CheckBadge prefix="mobile-library" selected={selectedIds.has(hero.id)} />}
                  </div>
                );
              }
              return (
                <div key={row.key} style={{ ...style, display: "flex" }} className="mobile-library__row-grid">
                  {row.items.map((item) => (
                    <div
                      key={item.id}
                      className="mobile-library__cell-wrap"
                      data-selected={selectedIds.has(item.id)}
                      style={{ width: cellSize, height: cellSize }}
                    >
                      <FadeImage
                        src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`}
                        alt={assetAlt(item)}
                        data-asset-id={item.id}
                        tabIndex={-1}
                        loading="lazy"
                        className="mobile-library__cell"
                        style={{ width: cellSize, height: cellSize }}
                        onClick={() => openItem(item)}
                      />
                      <TileOverlays item={item} tileWidth={cellSize} prefix="mobile-library" />
                      {selectMode && <CheckBadge prefix="mobile-library" selected={selectedIds.has(item.id)} />}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {!isTileView && items.length > 0 && assetsError && (
          <div className="mobile-library__load-error" role="alert">
            <span>Couldn't load more photos.</span>
            <button type="button" className="mobile-library__retry" onClick={retryAssets}>
              Retry
            </button>
          </div>
        )}
      </div>
      {selectMode && (
        // Laid out like Photos' select toolbar (#259): Share at the left, the
        // count in the middle, the action at the right, 44pt targets.
        <div className="mobile-library__select-bar" data-testid="select-bar">
          <div className="mobile-library__select-row">
            <button
              type="button"
              className="mobile-library__bar-button"
              aria-label="Share"
              onClick={handleShareSelection}
              disabled={selectedIds.size === 0 || sharing}
            >
              <Icon name="share" />
            </button>
            <span className="mobile-library__select-summary">
              <span className="mobile-library__select-count" aria-live="polite">
                {selectionCountLabel(items, selectedIds)}
              </span>
              {selectedIds.size > 0 && (
                <button type="button" aria-label="Deselect all" title="Deselect" onClick={() => setSelectedIds(new Set())}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
            <button
              type="button"
              className="mobile-library__bar-button mobile-library__bar-button--end"
              aria-label="Download"
              onClick={() => void handleDownloadSelection()}
              disabled={selectedIds.size === 0 || zip.busy}
            >
              <Icon name="download" />
            </button>
          </div>
          {selectedIds.size > 0 && zip.state.phase === "idle" && (
            <p className="mobile-library__select-caption">
              {selectedIds.size === 1 ? "Downloads the original file." : "Downloads all selected items in a ZIP file."}
            </p>
          )}
          {(selectedIds.size > 0 || zip.state.phase !== "idle") && (
            <ZipStatus
              state={zip.state}
              jpeg={zip.jpeg}
              onJpegChange={zip.setJpeg}
              showHeicOption={selectionHasHeicPhoto}
              variant="row"
            />
          )}
        </div>
      )}
      {zip.heicFallback && (
        <HeicFallbackModal files={zip.heicFallback} onDownloadOriginals={zip.downloadOriginals} onClose={zip.dismissHeicFallback} />
      )}
      {openIndex !== null && (
        <MobileViewer
          libraryId={libraryId}
          items={items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          revealItem={(id) => {
            const row = findRowIndexByAsset(rows, id);
            if (row !== -1) rowVirtualizer.scrollToIndex(row, { align: "auto" });
          }}
        />
      )}
    </div>
  );
}
