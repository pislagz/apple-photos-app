import { TileOverlays } from "./TileOverlays";
import HeicFallbackModal from "./HeicFallbackModal";
import ZipStatus from "./ZipStatus";
import { selectionHasHeic, useZipDownload } from "./zipDownload";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createPortal } from "react-dom";
import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import FilterMenu from "./FilterMenu";
import { useLibraryFilter } from "./useLibraryFilter";
import { assetAlt } from "../assetAlt";
import { albumMessages, isWholeLibraryEmpty, LIBRARY_EMPTY_TEXT } from "./albumText";
import LibraryEmptyState from "./LibraryEmptyState";
import { Icon } from "../icons";
import { canShareFiles, copyAssetLink, downloadAsset, shareAssets, downloadVersion, resolveVersion } from "../viewer/download";
import DesktopViewer from "../viewer/DesktopViewer";
import { VIEWS, type ViewKey } from "./grouping";
import {
  columnsForEdge,
  columnWidths,
  DEFAULT_ZOOM_INDEX,
  gapForEdge,
  featureHeight,
  featureRowHeight,
  featureWidth,
  gridRowHeight,
  squareEdge,
  thumbSizeFor,
  ZOOM_EDGES,
} from "./gridMetrics";
import DateTitle from "./DateTitle";
import { desktopTitle, titleScrimProgress } from "./libraryTitle";
import PeriodCardGrid from "./PeriodCards";
import { buildPeriodCards, buildRows, columnOf, type LibraryRow, verticalTarget } from "./rows";
import { useLibrarySummary } from "./useLibrarySummary";
import { useDeepLinkOpen } from "./useDeepLinkOpen";
import { useLibraryAssets } from "./useLibraryAssets";
import { useLandOnPeriod, useOldestFirstScroll, useViewerIndex } from "./useOldestFirstScroll";
import { InfoRows } from "../viewer/InfoRows";
import { useAssetDetailState, useSelectionSummary } from "../viewer/useAssetDetail";
import { buildInfoRows, buildSelectionRows } from "../viewer/viewerInfo";
import FadeImage from "./FadeImage";
import { useSlidingPill } from "./useSlidingPill";
import { isTypingTarget, shortcutAction } from "../shortcuts";

// #209: month section headers are 40 px tall (15 px / 700 in CSS).
const HEADER_ROW_HEIGHT = 40;
// Height of the overlaid title and its scrim; a month header starting inside
// this band would sit under the title, so the title steps aside (#209).
const TITLE_BAND_PX = 56;
const MAX_ZOOM_INDEX = ZOOM_EDGES.length - 1;

// The toolbar's segmented control is Years/Months/All Photos. Days is its
// own sidebar item on Sequoia (#127), reached via `fixedView="days"`.
const DESKTOP_VIEWS = VIEWS.filter((item) => item.key !== "days");
const LOAD_MORE_ROW_MARGIN = 3;
// Pointer travel before a press on the grid turns into a rubber-band drag, so
// a plain click on a cell still just selects it (#97).
const DRAG_THRESHOLD_PX = 4;
// #265: our own double-click: a second plain click within this time, on the
// same tile or within a few px of the first one (so a re-layout between the
// clicks can't turn it into two single clicks on different elements).
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_SLOP_PX = 6;

// A single selected file downloads directly (a multi-selection goes through
// the streamed zip, P3.2). This never touches `/original` on its own -- only an explicit
// click does.
function downloadSelection(libraryId: number, ids: Iterable<string>) {
  for (const id of ids) {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId}/original/${id}?download=1`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

// P1.15: the desktop Library grid. Toolbar (Years/Months/All Photos, zoom,
// download, Info toggle, selection count), a virtualized
// grid with inline date headers, hover heart/duration, and
// click/modifier/shift/drag selection. Like the mobile Library (P1.14),
// this only ever pages `/assets` -- never `/hidden` -- so a hidden asset
// (P1.13) can't reach any view or ⌘A. Cells request thumbnails only; a
// download is the only thing that may hit `/original`.
// One grid tile. Memoised so a selection change re-renders only the tiles
// whose `selected` flips: the rest keep their element and decoded image (#265).
const GridCell = memo(function GridCell({
  item,
  index,
  libraryId,
  thumbSize,
  squareMode,
  selected,
  height,
  tileWidth,
  featureLabel,
  onCellClick,
  onCellDoubleClick,
  onCellContextMenu,
  setCellRef,
}: {
  item: AssetListItem;
  index: number;
  libraryId: number;
  thumbSize: string;
  squareMode: boolean;
  selected: boolean;
  height: number;
  tileWidth: number;
  featureLabel: string | null;
  onCellClick: (event: React.MouseEvent, item: AssetListItem, index: number) => void;
  onCellDoubleClick: (id: string) => void;
  onCellContextMenu: (event: React.MouseEvent, id: string) => void;
  setCellRef: (id: string, element: HTMLElement | null) => void;
}) {
  const ref = useCallback((element: HTMLElement | null) => setCellRef(item.id, element), [setCellRef, item.id]);
  return (
    <div
      ref={ref}
      data-asset-id={item.id}
      // Focus lands here when the Viewer closes (D59); arrow keys bubble to the grid.
      tabIndex={-1}
      data-testid="library-cell"
      role="option"
      aria-selected={selected}
      data-selected={selected}
      className="desktop-library__cell"
      style={{ height }}
      onClick={(event) => onCellClick(event, item, index)}
      onDoubleClick={() => onCellDoubleClick(item.id)}
      onContextMenu={(event) => onCellContextMenu(event, item.id)}
    >
      <FadeImage
        src={`/api/libraries/${libraryId}/thumb/${item.id}?size=${thumbSize}`}
        alt={assetAlt(item)}
        loading="lazy"
        draggable={false}
        className="desktop-library__thumb"
        style={{ objectFit: squareMode ? "cover" : "contain" }}
      />
      {featureLabel !== null && <div className="desktop-library__feature-caption">{featureLabel}</div>}
      <TileOverlays item={item} tileWidth={tileWidth} prefix="desktop-library" />
    </div>
  );
});

export default function DesktopLibrary({
  libraryId,
  initialAssetId,
  onInitialAssetOpened,
  fixedView,
  onOpenDay,
  initialView,
  initialScrollDayKey,
  album,
  isAdmin = false,
  onCount,
  title = "Library",
  subtitle,
  toolbarSlot,
}: {
  libraryId: number;
  isAdmin?: boolean;
  initialAssetId?: string;
  onInitialAssetOpened?: () => void;
  // Sidebar-driven view (Days, #127): pins the view and hides the
  // Years/Months/All Photos switch.
  fixedView?: ViewKey;
  // #152: in the fixed Days view, opening a day hands off to the shell
  // (which shows Library > All Photos) instead of opening the Viewer.
  onOpenDay?: (dayKey: string) => void;
  // One-shot start state, read on mount only (#152).
  initialView?: ViewKey;
  initialScrollDayKey?: string;
  // P2.1: an album's id (or `smart:<slug>`); pair with `fixedView="all"`.
  album?: string;
  // #225: reports how many items are loaded and whether that is all of them
  // (the Search heading shows "N items").
  onCount?: (count: number, done: boolean) => void;
  // #296: the page heading's title, and the shell's fixed toolbar row that
  // the view controls render into (inline above the heading when absent).
  title?: string;
  // Replaces the date range under the title (Search shows "N items").
  subtitle?: string;
  toolbarSlot?: HTMLElement | null;
}) {
  const [switchedView, setView] = useState<ViewKey>(initialView ?? "all");
  const view = fixedView ?? switchedView;
  const segmentRef = useSlidingPill<HTMLDivElement>(view, fixedView === undefined);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [squareMode, setSquareMode] = useState(true);
  const filterState = useLibraryFilter();
  const { filter, hide } = filterState;
  const [infoOpen, setInfoOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // `hasEdited` starts `null` (still resolving) so the menu never shows
  // "Download Original" for a photo that turns out to have no edited version.
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number; hasEdited: boolean | null } | null>(
    null,
  );
  const anchorIdRef = useRef<string | null>(null);
  // Holds the arrow-key target index (counted from the newest end, #224) while it is still past the loaded
  // items, so the reconciliation effect below can catch focus up once
  // `loadMore` delivers the page that contains it.
  const desiredIndexRef = useRef<number | null>(null);
  // D12/D13: the column an Up/Down run started in. A full-width row (the Days
  // lead photo) or a short last row would otherwise reset it. Only valid while
  // the focused cell is still the one the run last landed on, so a click, a
  // Left/Right move or a new selection starts a fresh run.
  const goalColumnRef = useRef<{ id: string; column: number } | null>(null);
  // Down past the last loaded row: where the run started, until the next page
  // arrives and the move can be finished through the row model.
  // `count` Down presses are owed (more arrive while the page loads).
  // The run heads down in a newest-first list and up in the oldest-first
  // Library, where the unloaded pages are above.
  const pendingDownRef = useRef<{ id: string; column: number; count: number } | null>(null);

  // #224: the Library (no album) lists oldest first and opens at the newest
  // photos; albums, search, people and places keep newest first.
  const oldestFirst = !album;
  const { items, total, loading, done, error, retry, loadMore, loadAll } = useLibraryAssets(libraryId, null, filter, album ?? null, hide, oldestFirst);
  // Index counted from the newest end: stable when older pages are added on
  // top. Its own inverse, so it also maps back to a list position.
  const fromNewest = useCallback((index: number) => (oldestFirst ? items.length - 1 - index : index), [oldestFirst, items.length]);
  const libraryEmpty = !album && filter === "all" && done && !error && items.length === 0;
  useEffect(() => {
    if (!loading || items.length > 0) onCount?.(items.length, done);
  }, [items.length, done, loading, onCount]);
  // #98: the Info toggle opens an inspector for the focused cell. It only
  // fetches the JSON detail route while open, never `/original`.
  const multiSelected = selected.size >= 2;
  const { detail: infoDetail, failed: infoFailed } = useAssetDetailState(
    libraryId,
    infoOpen && !multiSelected ? focusedId : null,
  );
  // D21: two or more selected photos get a summary instead of the last-clicked one.
  const selectionIds = useMemo(() => (infoOpen && multiSelected ? Array.from(selected) : null), [infoOpen, multiSelected, selected]);
  const { summary: selectionSummary, failed: selectionFailed } = useSelectionSummary(libraryId, selectionIds);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // clientWidth excludes a classic scrollbar, so the last column ends flush with the visible edge.
    const measure = () => setContainerWidth(element.clientWidth || element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const edge = ZOOM_EDGES[zoomIndex];
  const gap = gapForEdge(edge);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const thumbSize = thumbSizeFor(edge, dpr);
  const columns = columnsForEdge(containerWidth, edge, gap);
  const isPeriodView = view === "years" || view === "months" || view === "days";
  // #307: Years/Months are cards from `/summary`, fetched on first use. They
  // have no photo rows, so the virtualizer has nothing to do in those views.
  const summaryWanted = useRef(false);
  if (isPeriodView) summaryWanted.current = true;
  const { summary, error: summaryError, retry: retrySummary } = useLibrarySummary(libraryId, summaryWanted.current && !album);
  const periodCards = useMemo(() => {
    if (!isPeriodView) return [];
    return summary ? buildPeriodCards(view === "years" ? summary.years : view === "months" ? summary.months : summary.days, view as "years" | "months" | "days") : [];
  }, [view, summary, isPeriodView]);
  const rows = useMemo(() => (isPeriodView ? [] : buildRows(items, view, columns, oldestFirst, total)), [isPeriodView, items, view, columns, oldestFirst, total]);
  const widths = useMemo(() => columnWidths(containerWidth, columns, gap, dpr), [containerWidth, columns, gap, dpr]);
  const cellSize = squareEdge(containerWidth, columns, gap, dpr);
  const tileWidth = widths.length ? Math.min(...widths) : cellSize;

  const rowSize = useCallback(
    (row: LibraryRow) =>
      row.type === "header" ? HEADER_ROW_HEIGHT : row.type === "feature" ? featureRowHeight(containerWidth, cellSize, gap) : gridRowHeight(cellSize, gap),
    [containerWidth, cellSize, gap],
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowSize(rows[index]),
    overscan: 6,
  });
  const { scrollToEnd } = useOldestFirstScroll({ scrollRef, rows, rowSize, ready: oldestFirst && !isPeriodView && containerWidth > 0 });

  // Row heights depend on the container width and column count, but the
  // virtualizer caches sizes per index; drop the cache when they change so a
  // window resize does not leave rows overlapping the Days lead photo (#153).
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, containerWidth, columns]);

  // Zoom anchor (#207): remember the item at the viewport's vertical centre
  // before a zoom change and scroll it back to the centre once the new rows exist.
  const zoomAnchorRef = useRef<string | null>(null);
  const changeZoom = useCallback(
    (next: number) => {
      if (next === zoomIndex) return;
      const scroller = scrollRef.current;
      const centre = (scroller?.scrollTop ?? 0) + (scroller?.clientHeight ?? 0) / 2;
      const centred = rowVirtualizer.getVirtualItems().find((v) => v.start <= centre && centre < v.end);
      let anchor: { items: { id: string }[] } | undefined;
      for (let i = centred?.index ?? -1; i >= 0 && i < rows.length && !anchor; i++) {
        const row = rows[i];
        if (row.type !== "header") anchor = row;
      }
      const mid = anchor?.items[Math.floor(anchor.items.length / 2)];
      zoomAnchorRef.current = mid?.id ?? null;
      setZoomIndex(next);
    },
    [zoomIndex, rowVirtualizer, rows],
  );
  useLayoutEffect(() => {
    const id = zoomAnchorRef.current;
    if (!id) return;
    zoomAnchorRef.current = null;
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.id === id));
    if (rowIndex !== -1) rowVirtualizer.scrollToIndex(rowIndex, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomIndex]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  // #118: the title covers the rows actually on screen (the virtualizer's
  // overscan rows are not), so it follows scroll like sequoia-library-grid.png
  // and never claims dates from pages that are not on screen.
  const scrollOffset = rowVirtualizer.scrollOffset ?? 0;
  const viewportHeight = rowVirtualizer.scrollRect?.height ?? 0;
  const { dateRangeLabel, headerInBand } = useMemo(() => {
    const onScreen = virtualRows.filter(
      (row) => viewportHeight <= 0 || (row.end > scrollOffset && row.start < scrollOffset + viewportHeight),
    );
    const dated: string[] = [];
    let headerInBand = false;
    for (const virtualRow of onScreen) {
      const row = rows[virtualRow.index];
      if (row.type === "header") {
        if (virtualRow.start < scrollOffset + TITLE_BAND_PX) headerInBand = true;
        continue;
      }
      for (const item of row.items) if (item.date) dated.push(item.date);
    }
    return { dateRangeLabel: desktopTitle(view, dated), headerInBand };
  }, [virtualRows, rows, scrollOffset, viewportHeight, view]);

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last || loading || done) return;
    // Oldest first: the unloaded pages are above the first row.
    if (oldestFirst ? virtualRows[0].index <= LOAD_MORE_ROW_MARGIN : last.index >= rows.length - 1 - LOAD_MORE_ROW_MARGIN) loadMore();
  }, [virtualRows, rows.length, loading, done, loadMore, oldestFirst]);

  // Keyboard/click focus has to stay on-screen: the virtualizer only mounts
  // rows near the viewport, so moving focus by state alone (as selection
  // does) leaves the newly-focused cell unmounted if it was outside the
  // overscan window.
  // A clicked tile is already under the pointer: scrolling it "into view"
  // would move the grid between the two clicks of a double-click (#265).
  const clickFocusIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedId) return;
    if (clickFocusIdRef.current === focusedId) {
      clickFocusIdRef.current = null;
      return;
    }
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.id === focusedId));
    if (rowIndex !== -1) rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [focusedId, rows, rowVirtualizer]);

  const selectSingle = useCallback((id: string) => {
    setSelected(new Set([id]));
    anchorIdRef.current = id;
    setFocusedId(id);
  }, []);

  // Shift+arrow: grow the selection from the anchor to the new focus (#217).
  const extendTo = useCallback(
    (id: string) => {
      const anchor = anchorIdRef.current ?? focusedId ?? id;
      const from = items.findIndex((candidate) => candidate.id === anchor);
      const to = items.findIndex((candidate) => candidate.id === id);
      if (from === -1 || to === -1) {
        selectSingle(id);
        return;
      }
      anchorIdRef.current = anchor;
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setSelected(new Set(items.slice(lo, hi + 1).map((candidate) => candidate.id)));
      setFocusedId(id);
    },
    [items, focusedId, selectSingle],
  );

  // Reconciles an arrow-key target that was past the loaded items at the
  // time of the keypress: once the requested page arrives, catch focus up
  // to it (loading another page first if it still isn't far enough).
  useEffect(() => {
    const desired = desiredIndexRef.current;
    if (desired === null) return;
    if (desired < items.length) {
      selectSingle(items[fromNewest(desired)].id);
      desiredIndexRef.current = null;
    } else if (!done && !loading) {
      loadMore();
    } else {
      desiredIndexRef.current = null;
    }
  }, [items, done, loading, loadMore, selectSingle, fromNewest]);

  // Finishes the Down presses that ran past the last loaded row (see
  // `pendingDownRef`), one row at a time through the row model.
  useEffect(() => {
    const pending = pendingDownRef.current;
    if (!pending || loading) return;
    let id = pending.id;
    while (pending.count > 0) {
      const target = verticalTarget(rows, id, oldestFirst ? -1 : 1, pending.column);
      if (target === "end" || target === "unknown" || target === null) break;
      id = target;
      pending.count -= 1;
    }
    if (id !== pending.id) {
      selectSingle(id);
      goalColumnRef.current = { id, column: pending.column };
    }
    if (pending.count > 0 && !done) {
      pending.id = id;
      loadMore();
    } else {
      pendingDownRef.current = null;
    }
  }, [rows, loading, done, loadMore, selectSingle, oldestFirst]);

  const [viewerIndex, setViewerIndex] = useViewerIndex(items);
  // Set right before drilling a zoom level in, so the scroll effect below
  // can land on the opened tile's own row once the new view's rows exist.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  // Years -> Months: the year whose first month card to land on.
  const [pendingYearKey, setPendingYearKey] = useState<string | null>(null);
  // Months -> All Photos: the month ("2022-01") whose newest photo goes to the top.
  const [pendingMonthKey, setPendingMonthKey] = useState<string | null>(initialScrollDayKey ?? null);

  // Opens the Viewer and also scrolls the grid behind it to the photo.
  const openFromLink = useCallback(
    (index: number) => {
      setViewerIndex(index);
      setPendingScrollId(items[index]?.id ?? null);
    },
    [items, setViewerIndex],
  );
  useDeepLinkOpen(initialAssetId, items, loading, done, loadMore, openFromLink, onInitialAssetOpened);

  // Lands the just-switched-to view scrolled to the tile that was opened,
  // not back at the top -- see `handleOpen` below.
  useEffect(() => {
    if (!pendingScrollId) return;
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.id === pendingScrollId));
    if (rowIndex !== -1) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: "center" });
      setPendingScrollId(null);
    }
  }, [pendingScrollId, rows, rowVirtualizer]);

  // Years/Months sit scrolled to the bottom (newest). The Library's photos
  // open there too (useOldestFirstScroll); newest-first lists start at the top.
  const previousViewRef = useRef(view);
  useLayoutEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (!oldestFirst && (previous === "years" || previous === "months" || previous === "days") && !isPeriodView && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [view, isPeriodView, oldestFirst]);

  // From a Month or Day card: load older pages until the period is in the
  // list, then scroll its first photo to the top.
  const clearPendingMonth = useCallback(() => setPendingMonthKey(null), []);
  const scrollToRowStart = useCallback((rowIndex: number) => rowVirtualizer.scrollToIndex(rowIndex, { align: "start" }), [rowVirtualizer]);
  useLandOnPeriod({
    key: pendingMonthKey,
    active: oldestFirst && view === "all",
    items,
    rows,
    loading,
    done,
    loadMore,
    scrollToRow: scrollToRowStart,
    onLanded: clearPendingMonth,
  });

  // Newest-first lists: keep loading until the requested month's first photo
  // is there, then scroll it to the top.
  useEffect(() => {
    if (!pendingMonthKey || view !== "all" || oldestFirst) return;
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.date?.startsWith(pendingMonthKey)));
    if (rowIndex !== -1) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: "start" });
      setPendingMonthKey(null);
    } else if (done) {
      setPendingMonthKey(null);
    } else if (!loading) {
      loadMore();
    }
  }, [pendingMonthKey, view, rows, done, loading, loadMore, rowVirtualizer, oldestFirst]);

  // Years and Months cards drill one level down (#307); Years -> Months
  // lands on that year's first month, Months -> All Photos on that month.
  const handleOpenPeriod = useCallback(
    (key: string) => {
      if (view === "days") {
        // #301: Day card -> the shell opens All Photos at that day.
        if (onOpenDay) onOpenDay(key);
        else {
          setPendingMonthKey(key);
          setView("all");
        }
      } else if (view === "years") {
        setPendingYearKey(key);
        setView("months");
      } else {
        setPendingMonthKey(key);
        setView("all");
      }
    },
    [view, onOpenDay],
  );

  // A double-click (or Enter/Space on the focused cell) opens the Viewer at
  // this id's position in `items` (Days hands off to the shell) -- the
  // current Library view's own array, never `/hidden` (P1.13), so the
  // Viewer can only ever page through what the grid itself shows.
  const handleOpen = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index !== -1) setViewerIndex(index);
    },
    [items],
  );

  const lastClickRef = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  const openedByClicksAtRef = useRef(-Infinity);

  const handleCellClick = useCallback(
    (event: React.MouseEvent, item: AssetListItem, index: number) => {
      if (suppressClickRef.current) return;
      const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
      const now = performance.now();
      const last = lastClickRef.current;
      if (
        plain &&
        last &&
        now - last.time <= DOUBLE_CLICK_MS &&
        (last.id === item.id || Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_CLICK_SLOP_PX)
      ) {
        lastClickRef.current = null;
        openedByClicksAtRef.current = now;
        handleOpen(last.id);
        return;
      }
      lastClickRef.current = plain ? { id: item.id, time: now, x: event.clientX, y: event.clientY } : null;
      clickFocusIdRef.current = item.id;
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
    [items, selectSingle, handleOpen],
  );

  // The browser's own dblclick still opens (keyboard-less assistive tech,
  // synthetic events), unless the two clicks above already did.
  const handleCellDoubleClick = useCallback(
    (id: string) => {
      if (performance.now() - openedByClicksAtRef.current <= DOUBLE_CLICK_MS) return;
      handleOpen(id);
    },
    [handleOpen],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Period cards are buttons that handle their own Enter/Space.
      if (isPeriodView) return;
      // Cmd/Ctrl combos (select all, zoom) live in the window handler below.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(Math.min(MAX_ZOOM_INDEX, zoomIndex + 1));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        changeZoom(Math.max(0, zoomIndex - 1));
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
      const moveTo = event.shiftKey ? extendTo : selectSingle;
      // Right and Down move toward newer photos: forward in the oldest-first
      // Library, backward in a newest-first list.
      const flat = (value: number) => (oldestFirst ? -value : value);
      const found = focusedId ? items.findIndex((item) => item.id === focusedId) : -1;
      const currentIndex = found === -1 ? -1 : fromNewest(found);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (pendingDownRef.current) {
          if (event.key === (oldestFirst ? "ArrowUp" : "ArrowDown")) pendingDownRef.current.count += 1;
          return;
        }
        // Nothing focused yet: the first press selects the first photo. The
        // old flat +columns move landed in the last column of the first row
        // and every press after that was a column off (D13).
        if (!focusedId) {
          moveTo(items[fromNewest(0)].id);
          return;
        }
        // Rows restart after every date header (and Days has a hero row), so
        // move through the built row model to the visually adjacent cell
        // instead of +-columns in the flat list (#96).
        const goal = goalColumnRef.current?.id === focusedId ? goalColumnRef.current.column : columnOf(rows, focusedId);
        const column = goal ?? 0;
        const target = verticalTarget(rows, focusedId, event.key === "ArrowDown" ? 1 : -1, column);
        if (target && target !== "end" && target !== "unknown") {
          moveTo(target);
          goalColumnRef.current = { id: target, column };
          return;
        }
        if (target === null || target === "end") {
          // Finish through the row model once the next page is in; the flat
          // +columns fallback is wrong across date groups and the lead photo.
          // The unloaded pages are below a newest-first list, above the Library.
          if ((oldestFirst ? target === null : target === "end") && !done) {
            pendingDownRef.current = { id: focusedId, column, count: 1 };
            loadMore();
          }
          return;
        }
      }
      const base = desiredIndexRef.current ?? (currentIndex === -1 ? 0 : currentIndex);
      const desired = Math.max(0, base + flat(delta));
      const nextIndex = Math.min(items.length - 1, desired);
      if (desired > nextIndex && !done) {
        desiredIndexRef.current = desired;
        loadMore();
      } else {
        desiredIndexRef.current = null;
      }
      moveTo(items[fromNewest(nextIndex)].id);
    },
    [items, rows, columns, zoomIndex, changeZoom, focusedId, handleOpen, selectSingle, extendTo, done, loadMore, oldestFirst, fromNewest],
  );

  const setCellRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) cellRefs.current.set(id, element);
    else cellRefs.current.delete(id);
  }, []);

  // Drag-select (#97): a left press on the grid -- background or a cell --
  // arms a rubber band; once the pointer travels DRAG_THRESHOLD_PX it draws the
  // marquee and updates the selection live from the rendered cell rects, like
  // macOS Photos. Only presently-mounted (virtualized-visible) cells can be
  // hit, same as a real click. A drag that started on a cell must not also
  // fire that cell's click on mouseup, hence `suppressClickRef`.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const handleGridMouseDown = useCallback((event: React.MouseEvent) => {
    if (isPeriodView) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const grid = scrollRef.current;
    // Presses on the scrollbar (right of the content box) are not drags.
    if (grid && event.clientX >= grid.getBoundingClientRect().left + grid.clientWidth) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragActive(true);
  }, [isPeriodView]);

  useEffect(() => {
    if (!dragActive) return;
    let moved = false;
    function onMove(event: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const rect = {
        left: Math.min(start.x, event.clientX),
        top: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      setMarquee(rect);
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
      setSelected(hits);
      anchorIdRef.current = null;
    }
    function onUp() {
      dragStartRef.current = null;
      setMarquee(null);
      setDragActive(false);
      if (moved) {
        suppressClickRef.current = true;
        // The click that follows this mouseup fires synchronously.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragActive]);

  const zip = useZipDownload(libraryId);
  const selectionHasHeicPhoto = useMemo(() => selectionHasHeic(items, selected), [items, selected]);
  const handleDownload = useCallback(() => {
    if (selected.size === 0) return;
    // One file stays a plain download; several become one streamed zip (P3.2).
    if (selected.size === 1) downloadSelection(libraryId, selected);
    else void zip.start([...selected], { forceNative: !selectionHasHeicPhoto });
  }, [libraryId, selected, zip.start, selectionHasHeicPhoto]);

  const shareSupported = canShareFiles();
  const handleShare = useCallback(async () => {
    const toShare = items.filter((item) => selected.has(item.id));
    if (toShare.length === 0) return;
    try {
      await shareAssets(libraryId, toShare.map((item) => ({ id: item.id, filename: item.filename, original_filename: item.original_filename })));
    } catch {
      // Nothing useful to show; the user can still use Download.
    }
  }, [items, selected, libraryId]);

  // Right-click on a single cell (ios17-viewer.png's Download/Copy Link
  // pair, mirrored here per the P1.17 issue's "grid context menu"): picks
  // edited vs. original the same way the Viewer does, independent of
  // whatever is multi-selected.
  const handleCellContextMenu = useCallback(
    (event: React.MouseEvent, id: string) => {
      event.preventDefault();
      setContextMenu({ id, x: event.clientX, y: event.clientY, hasEdited: null });
      void resolveVersion(libraryId, id).then((version) => {
        setContextMenu((current) => (current?.id === id ? { ...current, hasEdited: version === "edited" } : current));
      });
    },
    [libraryId],
  );

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss() {
      setContextMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  // A filtered selection or focus would point at items that just left the grid.
  const filterKey = `${filter}|${hide.join(",")}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;

    setSelected(new Set());
    setFocusedId(null);
    setViewerIndex(null);
  }, [filterKey]);

  // Esc clears the selection only when nothing layered on top (Viewer, modal,
  // menus) is open -- those own the first Esc.
  const hasSelection = selected.size > 0;
  const overlayOpen = viewerIndex !== null || contextMenu !== null || zip.heicFallback !== null;
  useEffect(() => {
    if (!hasSelection || overlayOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection, overlayOpen]);

  // #217 Cmd/Ctrl shortcuts, on the window so they work wherever focus sits
  // (after a click on empty space, or on a toolbar button) but never while
  // typing in a field. With the Viewer open they belong to the Viewer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = shortcutAction(event);
      // The app-wide guard (#366) already cancelled the browser's Select All.
      if ((event.defaultPrevented && action !== "selectAll") || viewerIndex !== null || contextMenu !== null) return;
      if (isTypingTarget(event.target)) return;
      const toNewest =
        (event.key === "End" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) ||
        ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "ArrowDown");
      if (toNewest && (oldestFirst || isPeriodView)) {
        event.preventDefault();
        scrollToEnd(true);
      } else if (action === "selectAll" && !isPeriodView) {
        event.preventDefault();
        void loadAll().then((all) => setSelected(new Set(all.map((item) => item.id))));
      } else if (action === "zoomIn" || action === "zoomOut") {
        event.preventDefault();
        changeZoom(action === "zoomIn" ? Math.min(MAX_ZOOM_INDEX, zoomIndex + 1) : Math.max(0, zoomIndex - 1));
      } else if (action === "info") {
        event.preventDefault();
        setInfoOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewerIndex, contextMenu, isPeriodView, loadAll, changeZoom, zoomIndex, oldestFirst, scrollToEnd]);

  const handleGridClick = useCallback((event: React.MouseEvent) => {
    if (suppressClickRef.current || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-asset-id], button, a")) return;
    const grid = scrollRef.current;
    // A press on the scrollbar is not a click on empty space.
    if (grid && event.clientX >= grid.getBoundingClientRect().left + grid.clientWidth) return;
    setSelected(new Set());
    anchorIdRef.current = null;
  }, []);

  const controlsBar = (
    <>
      <div className="desktop-library__bar-left">
        <div className="desktop-library__zoom-slider">
          <button
            type="button"
            className="toolbar-button toolbar-button--small desktop-library__zoom-end"
            aria-label="Zoom Out"
            title="Zoom Out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((previous) => Math.max(0, previous - 1))}
          >
            <Icon name="minus" size={14} />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={0}
            max={MAX_ZOOM_INDEX}
            value={zoomIndex}
            style={{ "--range-fill": `${(zoomIndex / MAX_ZOOM_INDEX) * 100}%` } as CSSProperties}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <button
            type="button"
            className="toolbar-button toolbar-button--small desktop-library__zoom-end"
            aria-label="Zoom In"
            title="Zoom In"
            disabled={zoomIndex === MAX_ZOOM_INDEX}
            onClick={() => setZoomIndex((previous) => Math.min(MAX_ZOOM_INDEX, previous + 1))}
          >
            <Icon name="plus" size={14} />
          </button>
          {/* #264: belongs with the size slider -- both change how tiles look. */}
          <button
            type="button"
            className="toolbar-button"
            aria-label="Show Whole Photos"
            aria-pressed={!squareMode}
            onClick={() => setSquareMode((value) => !value)}
            title={squareMode ? "Show Whole Photos" : "Show Square Tiles"}
          >
            <Icon name="aspect" size={16} filled={!squareMode} />
          </button>
        </div>
      </div>
        {fixedView === undefined && (
        <div ref={segmentRef} role="tablist" aria-label="Library zoom" className="segmented-control">
          {DESKTOP_VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view === item.key}
              // #263: nothing to group into years or months yet.
              disabled={libraryEmpty && (item.key === "years" || item.key === "months")}
              className="segmented-control__item"
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        )}
      <div className="desktop-library__bar-right">
        {/* No dead button: sharing needs a secure (https) context, so it is
            hidden where unavailable, like macOS toolbars omit unusable items. */}
        {shareSupported && (
          <button
            type="button"
            className="toolbar-button"
            aria-label="Share"
            onClick={() => void handleShare()}
            disabled={selected.size === 0}
            title="Share"
          >
            <Icon name="share" size={16} />
          </button>
        )}
        <button
          type="button"
          className="toolbar-button"
          onClick={handleDownload}
          disabled={selected.size === 0 || zip.busy}
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
          <Icon name="info" size={16} filled={infoOpen} />
          <span className="sr-only">Info</span>
        </button>
        {(selected.size > 1 || zip.state.phase !== "idle") && (
          <ZipStatus
            state={zip.state}
            jpeg={zip.jpeg}
            onJpegChange={zip.setJpeg}
            showHeicOption={selectionHasHeicPhoto}
          />
        )}
        {selected.size > 0 && (
          <button
            type="button"
            className="toolbar-button"
            onClick={() => setSelected(new Set())}
            title="Deselect"
            aria-label="Deselect all"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </>
  );

  // #370: in the Library root the title and date sit over the photos (Mac
  // Photos style); the heading band stays in the DOM for screen readers only.
  const overlayHeading = title === "Library" && subtitle === undefined && !isPeriodView && !!dateRangeLabel;

  return (
    <div className="desktop-library" data-testid="desktop-library">
      {toolbarSlot ? (
        createPortal(controlsBar, toolbarSlot)
      ) : (
        <div className="desktop-library__toolbar" data-testid="desktop-library-toolbar">
          {controlsBar}
        </div>
      )}
      <div className="page-heading" data-testid="page-heading" data-overlay={overlayHeading || undefined}>
        <div className="page-heading__text">
          <h1 className="page-heading__title">{title}</h1>
          <p className="page-heading__subtitle" data-testid="selection-count">
            {selected.size > 0
              ? `${selected.size.toLocaleString()} of ${items.length.toLocaleString()}${done ? "" : "+"} selected`
              : (subtitle ?? (view !== "days" && dateRangeLabel ? dateRangeLabel : "\u00a0"))}
          </p>
        </div>
      </div>
      <div className="desktop-library__body">
      <div className="desktop-library__grid-wrap">
      <div className="desktop-library__filter-pill">
        <FilterMenu state={filterState} variant="desktop" label="Filter By" />
      </div>
      <div
        ref={scrollRef}
        className="desktop-library__grid"
        data-testid="desktop-library-grid"
        role="listbox"
        aria-label="Photos"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onMouseDown={handleGridMouseDown}
        onClick={handleGridClick}
      >
        {/* #157: Days labels each card with its own day (feature caption);
            the loaded-library range would sit on top of the first card. */}
        {dateRangeLabel && view !== "days" && !isPeriodView && (
          <div
            className="desktop-library__date-range"
            data-hidden={headerInBand || undefined}
            style={{ "--title-scrim": titleScrimProgress(scrollOffset) } as CSSProperties}
          >
            <div className="desktop-library__title-scrim" aria-hidden="true" />
            <DateTitle text={dateRangeLabel} className="desktop-library__title" testId="desktop-library-title" />
            {overlayHeading && selected.size > 0 && (
              <span className="desktop-library__title-sub" data-testid="desktop-library-title-sub">
                {`${selected.size.toLocaleString()} of ${items.length.toLocaleString()}${done ? "" : "+"} selected`}
              </span>
            )}
          </div>
        )}
        {isPeriodView && summaryError ? (
          <div className="desktop-library__empty" role="alert">
            <p>{albumMessages(album).error}</p>
            <button type="button" className="desktop-library__retry" onClick={retrySummary}>
              Retry
            </button>
          </div>
        ) : isPeriodView ? (
          summary !== null && periodCards.length === 0 ? (
            <p className="desktop-library__empty">{albumMessages(album).empty}</p>
          ) : (
            <PeriodCardGrid
              key={view}
              libraryId={libraryId}
              view={view as "years" | "months" | "days"}
              cards={periodCards}
              scrollRef={scrollRef}
              landOnKey={view === "months" ? pendingYearKey : null}
              onLanded={() => setPendingYearKey(null)}
              onOpen={handleOpenPeriod}
            />
          )
        ) : items.length === 0 && error ? (
          <div className="desktop-library__empty" role="alert">
            <p>{albumMessages(album).error}</p>
            <button type="button" className="desktop-library__retry" onClick={retry}>
              Retry
            </button>
          </div>
        ) : items.length === 0 && done ? (
          <LibraryEmptyState
            title={albumMessages(album).empty}
            text={isWholeLibraryEmpty(album) ? LIBRARY_EMPTY_TEXT : undefined}
            adminLink={isWholeLibraryEmpty(album) && isAdmin}
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
                return (
                  <div key={row.key} style={style} className="desktop-library__row-header">
                    {row.label}
                  </div>
                );
              }
              return (
                <div
                  key={row.key}
                  style={{
                    ...style,
                    display: "grid",
                    gap,
                    alignContent: "start",
                    gridTemplateColumns:
                      row.type === "feature" ? `${featureWidth(containerWidth, cellSize, gap)}px` : widths.length ? widths.map((w) => `${w}px`).join(" ") : `repeat(${columns}, 1fr)`,
                    justifyContent: row.type === "feature" ? "center" : undefined,
                  }}
                  className="desktop-library__row-grid"
                >
                  {row.items.map((item) => (
                    <GridCell
                      key={item.id}
                      item={item}
                      index={items.indexOf(item)}
                      libraryId={libraryId}
                      thumbSize={thumbSize}
                      squareMode={squareMode}
                      selected={selected.has(item.id)}
                      height={row.type === "feature" ? featureHeight(containerWidth, cellSize, gap) : cellSize}
                      tileWidth={tileWidth}
                      featureLabel={row.type === "feature" ? row.label : null}
                      onCellClick={handleCellClick}
                      onCellDoubleClick={handleCellDoubleClick}
                      onCellContextMenu={handleCellContextMenu}
                      setCellRef={setCellRef}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {!isPeriodView && items.length > 0 && error && (
          <div className="desktop-library__load-error" role="alert">
            <span>Couldn't load more photos.</span>
            <button type="button" className="desktop-library__retry" onClick={retry}>
              Retry
            </button>
          </div>
        )}
      </div>
      </div>
      {infoOpen && (
        <aside className="desktop-library__info-panel" data-testid="library-info-panel" aria-label="Info">
          {multiSelected ? (
            selectionSummary ? (
              <InfoRows rows={buildSelectionRows(selectionSummary)} className="desktop-library__info-rows" />
            ) : (
              <p className="desktop-library__info-empty">{selectionFailed ? "Couldn't load info." : "Loading…"}</p>
            )
          ) : infoDetail ? (
            <InfoRows rows={buildInfoRows(infoDetail, { includeFile: true })} className="desktop-library__info-rows" />
          ) : (
            <p className="desktop-library__info-empty">{!focusedId ? "No Selection" : infoFailed ? "Couldn't load info." : "Loading…"}</p>
          )}
        </aside>
      )}
      </div>
      {marquee && (
        <div
          className="desktop-library__marquee"
          data-testid="marquee"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}
      {zip.heicFallback && (
        <HeicFallbackModal files={zip.heicFallback} onDownloadOriginals={zip.downloadOriginals} onClose={zip.dismissHeicFallback} />
      )}
      {viewerIndex !== null && (
        <DesktopViewer
          libraryId={libraryId}
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          revealItem={(id) => {
            const row = rows.findIndex((r) => r.type !== "header" && r.items.some((cell) => cell.id === id));
            if (row !== -1) rowVirtualizer.scrollToIndex(row, { align: "auto" });
          }}
        />
      )}
      {contextMenu && (
        <div
          className="desktop-library__context-menu"
          data-testid="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              void downloadAsset(libraryId, contextMenu.id);
              setContextMenu(null);
            }}
          >
            Download
          </button>
          {contextMenu.hasEdited && (
            <button
              type="button"
              onClick={() => {
                downloadVersion(libraryId, contextMenu.id, "original");
                setContextMenu(null);
              }}
            >
              Download Original
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void copyAssetLink(libraryId, contextMenu.id);
              setContextMenu(null);
            }}
          >
            Copy Link
          </button>
        </div>
      )}
    </div>
  );
}
