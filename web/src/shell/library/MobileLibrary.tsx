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
import { albumMessages, isWholeLibraryEmpty, LIBRARY_EMPTY_TEXT } from "./albumText";
import LibraryEmptyState from "./LibraryEmptyState";
import { downloadSingleAsset, shareOrDownloadAssets, shareReadyFiles } from "../viewer/download";
import MobileViewer from "../viewer/MobileViewer";
import { VIEWS, type ViewKey } from "./grouping";
import PeriodCardGrid from "./PeriodCards";
import { buildPeriodCards, buildRows, type LibraryRow } from "./rows";
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
// Must equal --grid-gap-dense in tokens.css.
const MOBILE_GRID_GAP = 1;
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
  isAdmin = false,
  nav,
}: {
  libraryId: number;
  isAdmin?: boolean;
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
  // Opens on All Photos like iOS Photos (#304); Years/Months/Days stay in the switch.
  const [view, setView] = useState<ViewKey>("all");
  const viewRef = useRef(view);
  viewRef.current = view;
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
  const libraryEmpty = summary !== null && summary.years.length === 0;
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
    const assetId = assetIdAtPoint(row ? rows[row.index] : undefined, midpoint.clientX - rect.left, cellSize + MOBILE_GRID_GAP);
    if (row && assetId) pinchAnchor.current = { assetId, rowFraction: (y - row.start) / row.size, viewportY };
  });
  // #146: back to the newest photos -- drop the Month -> Days anchor and
  // scroll to the top. Re-selecting a zoom tab or the Library tab does this.
  // Years/Months are oldest first, so their newest end is the bottom (#307).
  const backToNewest = useCallback((target: ViewKey) => {
    setDaysAnchor(null);
    setPendingScrollKey(null);
    const element = scrollRef.current;
    if (element) element.scrollTop = target !== "all" ? element.scrollHeight : 0;
  }, []);
  const lastResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (lastResetSignal.current === resetSignal) return;
    lastResetSignal.current = resetSignal;
    backToNewest(viewRef.current);
  }, [resetSignal, backToNewest]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Set right before drilling Years -> Months, so Months can land on the
  // tapped year's first card.
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const isTileView = view === "years" || view === "months" || view === "days";

  useDeepLinkOpen(initialAssetId, items, loading, done, loadMore, setOpenIndex, onInitialAssetOpened);
  const [selectMode, setSelectMode] = useState(false);
  const segmentRef = useSlidingPill<HTMLDivElement>(view, !selectMode && !album);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  // Files already fetched for a share the browser blocked (expired tap); the
  // next Share tap hands them to the share sheet with no await in between.
  const [readyFiles, setReadyFiles] = useState<File[] | null>(null);
  const selectBarRef = useRef<HTMLDivElement | null>(null);
  const [selectBarHeight, setSelectBarHeight] = useState(0);

  const toggleSelected = useCallback((id: string) => {
    setReadyFiles(null);
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
    setReadyFiles(null);
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
      if (view === "months") {
        // Month -> Days lands on that month's first day card (#301).
        setPendingScrollKey(bucketKey);
        setView("days");
        return;
      }
      // Day -> All Photos at that day: the feed starts at the day's last
      // photo, newest-first (#126, `to` is a string compare on the local day).
      setDaysAnchor(bucketKey);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setView("all");
    },
    [view],
  );

  async function handleShareSelection() {
    if (readyFiles) {
      const outcome = await shareReadyFiles(readyFiles).catch(() => null);
      setReadyFiles(outcome?.status === "ready" ? outcome.files : null);
      return;
    }
    const toShare = items.filter((item) => selectedIds.has(item.id));
    if (toShare.length === 0) return;
    setSharing(true);
    try {
      const outcome = await shareOrDownloadAssets(
        libraryId,
        toShare.map((item) => ({ id: item.id, filename: item.filename, original_filename: item.original_filename })),
      );
      setReadyFiles(outcome.status === "ready" ? outcome.files : null);
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

  // The bar's height changes with its caption, progress line and HEIC row, so
  // the grid's bottom padding follows the measured height (#281 F12).
  useLayoutEffect(() => {
    const bar = selectBarRef.current;
    if (!selectMode || !bar) {
      setSelectBarHeight(0);
      return;
    }
    const measure = () => setSelectBarHeight(Math.ceil(bar.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [selectMode]);

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

  // #307: Years/Months are cards built straight from `/summary`, not rows
  // over the cursor-paged `items`; Days and All Photos use the virtualized rows.
  const periodCards = useMemo(() => {
    if (!isTileView) return [];
    return summary ? buildPeriodCards(view === "years" ? summary.years : view === "months" ? summary.months : summary.days, view) : [];
  }, [view, summary]);
  const rows = useMemo<LibraryRow[]>(() => (isTileView ? [] : buildRows(items, view, columns)), [isTileView, view, items, columns]);
  // The row's flex gap (--grid-gap-dense) sits between cells, so cells share
  // what is left of the width; dividing the full width overflowed the
  // scroller by (columns - 1)px and let the grid pan sideways (#281 F16).
  const cellSize = containerWidth > 0 ? (containerWidth - (columns - 1) * MOBILE_GRID_GAP) / columns : 0;

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

  const showSummaryError = isTileView && summaryError;
  // #147: Days / All Photos page `/assets`; a failed first page is an error, not an empty library.
  const showAssetsError = !isTileView && assetsError && items.length === 0;
  const isEmpty = isTileView ? summary !== null && periodCards.length === 0 : items.length === 0 && done;

  return (
    <div className="mobile-library">
      {(nav || view === "all" || !isTileView) && (
        // One flex row so the title can never sit under Select: the title
        // shrinks and ellipsizes, Select keeps its natural width. The scrim is
        // always on: Days has the white Select over a bright hero photo too (#176).
        <MobileGridHeader
          nav={nav}
          scrim={view === "all" ? titleScrimProgress(scrollOffset) : 1}
          showSelect={!isTileView}
          selectMode={selectMode}
          onToggleSelect={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          {(view === "all" || selectMode) && (
            <div className="mobile-library__title-block">
              {selectMode ? (
                <>
                  <div key="select" className="mobile-library__large-title" data-testid="header-title">
                    Select Items
                  </div>
                  <div className="mobile-library__subtitle" data-testid="header-subtitle" aria-live="polite">
                    <span key={selectedIds.size} className="date-title__text">
                      {selectedIds.size > 0 ? `${selectedIds.size} Selected` : "None Selected"}
                    </span>
                  </div>
                </>
              ) : pinnedPill ? (
                <DateTitle text={pinnedPill} className="mobile-library__pill" testId="header-subtitle" />
              ) : (
                <>
                  <div className="mobile-library__large-title" data-testid="header-title">
                    Library
                  </div>
                  <DateTitle text={pinnedSubtitle} className="mobile-library__subtitle" testId="header-subtitle" />
                </>
              )}
            </div>
          )}
        </MobileGridHeader>
      )}
      {!selectMode && !album && (
        <div ref={segmentRef} className="mobile-library__view-switch" role="tablist" aria-label="Library zoom">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view === item.key}
              // #263: nothing to group into years or months yet.
              disabled={libraryEmpty && (item.key === "years" || item.key === "months")}
              className="mobile-library__view-switch-item"
              onClick={() => {
                // A direct tab tap is not a drill-down (`openTile` below) --
                // clear any stale Month -> Days anchor so tapping Days here
                // starts at the top of the library, not back at the last
                // drilled-into month.
                backToNewest(item.key);
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
        style={{
          touchAction: "pan-y",
          ...(selectBarHeight > 0 ? { paddingBottom: selectBarHeight } : {}),
        }}
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
          <LibraryEmptyState
            title={albumMessages(album).empty}
            text={isWholeLibraryEmpty(album) ? LIBRARY_EMPTY_TEXT : undefined}
            adminLink={isWholeLibraryEmpty(album) && isAdmin}
          />
        ) : isTileView ? (
          <PeriodCardGrid
            key={view}
            libraryId={libraryId}
            view={view}
            cards={periodCards}
            scrollRef={scrollRef}
            landOnKey={view !== "years" ? pendingScrollKey : null}
            onLanded={() => setPendingScrollKey(null)}
            onOpen={openTile}
          />
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
        <div ref={selectBarRef} className="mobile-library__select-bar" data-testid="select-bar">
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
            <span className="mobile-library__select-count" aria-live="polite">
              {selectionCountLabel(items, selectedIds)}
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
          {readyFiles && (
            <p className="mobile-library__select-caption" role="status">
              Ready to share. Tap Share again.
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
