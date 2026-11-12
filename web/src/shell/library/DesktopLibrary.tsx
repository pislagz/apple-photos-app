import { TileOverlays } from "./TileOverlays";
import HeicFallbackModal from "./HeicFallbackModal";
import ZipStatus from "./ZipStatus";
import { useZipDownload } from "./zipDownload";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssetFilter, AssetListItem } from "../../api";
import { assetAlt } from "../assetAlt";
import { albumMessages } from "./albumText";
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
import { buildRows, columnOf, verticalTarget } from "./rows";
import { useDeepLinkOpen } from "./useDeepLinkOpen";
import { useLibraryAssets } from "./useLibraryAssets";
import { InfoRows } from "../viewer/InfoRows";
import { useAssetDetailState, useSelectionSummary } from "../viewer/useAssetDetail";
import { buildInfoRows, buildSelectionRows } from "../viewer/viewerInfo";
import FadeImage from "./FadeImage";
import { useSlidingPill } from "./useSlidingPill";

// #209: month section headers are 40 px tall (15 px / 700 in CSS).
const HEADER_ROW_HEIGHT = 40;
// Height of the overlaid title and its scrim; a month header starting inside
// this band would sit under the title, so the title steps aside (#209).
const TITLE_BAND_PX = 56;
const MAX_ZOOM_INDEX = ZOOM_EDGES.length - 1;
const FILTER_OPTIONS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "All Items" },
  { key: "favorites", label: "Favorites" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Videos" },
];

// The toolbar's segmented control is Years/Months/All Photos. Days is its
// own sidebar item on Sequoia (#127), reached via `fixedView="days"`.
const DESKTOP_VIEWS = VIEWS.filter((item) => item.key !== "days");
const LOAD_MORE_ROW_MARGIN = 3;
// Pointer travel before a press on the grid turns into a rubber-band drag, so
// a plain click on a cell still just selects it (#97).
const DRAG_THRESHOLD_PX = 4;

// #208: click flash length.
const FLASH_MS = 150;

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
export default function DesktopLibrary({
  libraryId,
  initialAssetId,
  onInitialAssetOpened,
  fixedView,
  onOpenDay,
  initialView,
  initialScrollAssetId,
  album,
}: {
  libraryId: number;
  initialAssetId?: string;
  onInitialAssetOpened?: () => void;
  // Sidebar-driven view (Days, #127): pins the view and hides the
  // Years/Months/All Photos switch.
  fixedView?: ViewKey;
  // #152: in the fixed Days view, opening a day hands off to the shell
  // (which shows Library > All Photos) instead of opening the Viewer.
  onOpenDay?: (id: string) => void;
  // One-shot start state, read on mount only (#152).
  initialView?: ViewKey;
  initialScrollAssetId?: string;
  // P2.1: an album's id (or `smart:<slug>`); pair with `fixedView="all"`.
  album?: string;
}) {
  const [switchedView, setView] = useState<ViewKey>(initialView ?? "years");
  const view = fixedView ?? switchedView;
  const segmentRef = useSlidingPill<HTMLDivElement>(view, fixedView === undefined);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [squareMode, setSquareMode] = useState(true);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // `hasEdited` starts `null` (still resolving) so the menu never shows
  // "Download Original" for a photo that turns out to have no edited version.
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number; hasEdited: boolean | null } | null>(
    null,
  );
  const anchorIdRef = useRef<string | null>(null);
  // Holds the arrow-key target index while it is still past the loaded
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
  const pendingDownRef = useRef<{ id: string; column: number; count: number } | null>(null);

  const { items, loading, done, error, retry, loadMore, loadAll } = useLibraryAssets(libraryId, null, filter, album ?? null);
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
  const rows = useMemo(() => buildRows(items, view, columns), [items, view, columns]);
  const widths = useMemo(() => columnWidths(containerWidth, columns, gap, dpr), [containerWidth, columns, gap, dpr]);
  const cellSize = squareEdge(containerWidth, columns, gap, dpr);
  const tileWidth = widths.length ? Math.min(...widths) : cellSize;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index].type === "header"
        ? HEADER_ROW_HEIGHT
        : rows[index].type === "feature"
          ? featureRowHeight(containerWidth, cellSize, gap)
          : gridRowHeight(cellSize, gap),
    overscan: 6,
  });

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
  // and never claims dates from pages that are not on screen. Items are sorted
  // newest first, so the range runs from the last visible item to the first.
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

  // Finishes the Down presses that ran past the last loaded row (see
  // `pendingDownRef`), one row at a time through the row model.
  useEffect(() => {
    const pending = pendingDownRef.current;
    if (!pending || loading) return;
    let id = pending.id;
    while (pending.count > 0) {
      const target = verticalTarget(rows, id, 1, pending.column);
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
  }, [rows, loading, done, loadMore, selectSingle]);

  // #208 click flash: a 35 % white overlay for FLASH_MS on the activated tile.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const handleCellClick = useCallback(
    (event: React.MouseEvent, item: AssetListItem, index: number) => {
      if (suppressClickRef.current) return;
      setFlashId(item.id);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashId(null), FLASH_MS);
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
  // Set right before drilling a zoom level in, so the scroll effect below
  // can land on the opened tile's own row once the new view's rows exist.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(initialScrollAssetId ?? null);

  useDeepLinkOpen(initialAssetId, items, loading, done, loadMore, setViewerIndex, onInitialAssetOpened);

  // Lands the just-switched-to view scrolled to the tile that was opened,
  // not back at the top -- see `handleOpen` below.
  useEffect(() => {
    if (!pendingScrollId) return;
    const rowIndex = rows.findIndex((row) => row.type !== "header" && row.items.some((item) => item.id === pendingScrollId));
    if (rowIndex !== -1) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: "start" });
      setPendingScrollId(null);
    }
  }, [pendingScrollId, rows, rowVirtualizer]);

  // A double-click (or Enter/Space on the focused cell) drills Years ->
  // Months -> All Photos (R3, #126), scrolled to this id's own date; only
  // All Photos opens the Viewer, at this id's position in `items` -- the
  // current Library view's own array, never `/hidden` (P1.13), so the
  // Viewer can only ever page through what the grid itself shows.
  const handleOpen = useCallback(
    (id: string) => {
      if (view === "years") {
        setPendingScrollId(id);
        setView("months");
        return;
      }
      if (view === "months") {
        setPendingScrollId(id);
        setView("all");
        return;
      }
      // Sequoia opens the whole day, not one photo (#152).
      if (view === "days" && onOpenDay) {
        onOpenDay(id);
        return;
      }
      const index = items.findIndex((item) => item.id === id);
      if (index !== -1) setViewerIndex(index);
    },
    [items, view, onOpenDay],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        loadAll().then((all) => setSelected(new Set(all.map((item) => item.id))));
        return;
      }
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
      const currentIndex = focusedId ? items.findIndex((item) => item.id === focusedId) : -1;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (pendingDownRef.current) {
          if (event.key === "ArrowDown") pendingDownRef.current.count += 1;
          return;
        }
        // Nothing focused yet: the first press selects the first photo. The
        // old flat +columns move landed in the last column of the first row
        // and every press after that was a column off (D13).
        if (!focusedId) {
          selectSingle(items[0].id);
          return;
        }
        // Rows restart after every date header (and Days has a hero row), so
        // move through the built row model to the visually adjacent cell
        // instead of +-columns in the flat list (#96).
        const goal = goalColumnRef.current?.id === focusedId ? goalColumnRef.current.column : columnOf(rows, focusedId);
        const column = goal ?? 0;
        const target = verticalTarget(rows, focusedId, event.key === "ArrowDown" ? 1 : -1, column);
        if (target && target !== "end" && target !== "unknown") {
          selectSingle(target);
          goalColumnRef.current = { id: target, column };
          return;
        }
        if (target === null) return;
        if (target === "end") {
          // Finish through the row model once the next page is in; the flat
          // +columns fallback is wrong across date groups and the lead photo.
          if (!done) {
            pendingDownRef.current = { id: focusedId, column, count: 1 };
            loadMore();
          }
          return;
        }
      }
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
    [items, rows, columns, zoomIndex, changeZoom, focusedId, handleOpen, selectSingle, done, loadMore, loadAll],
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
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const grid = scrollRef.current;
    // Presses on the scrollbar (right of the content box) are not drags.
    if (grid && event.clientX >= grid.getBoundingClientRect().left + grid.clientWidth) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragActive(true);
  }, []);

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
  const handleDownload = useCallback(() => {
    if (selected.size === 0) return;
    // One file stays a plain download; several become one streamed zip (P3.2).
    if (selected.size === 1) downloadSelection(libraryId, selected);
    else void zip.start([...selected]);
  }, [libraryId, selected, zip.start]);

  const shareSupported = canShareFiles();
  const handleShare = useCallback(async () => {
    const toShare = items.filter((item) => selected.has(item.id));
    if (toShare.length === 0) return;
    try {
      await shareAssets(libraryId, toShare.map((item) => ({ id: item.id, filename: item.filename })));
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

  useEffect(() => {
    if (!filterMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [filterMenuOpen]);

  // Esc clears the selection only when nothing layered on top (Viewer, modal,
  // menus) is open -- those own the first Esc.
  const hasSelection = selected.size > 0;
  const overlayOpen = viewerIndex !== null || contextMenu !== null || filterMenuOpen || zip.heicFallback !== null;
  useEffect(() => {
    if (!hasSelection || overlayOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(new Set());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection, overlayOpen]);

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

  function chooseFilter(next: AssetFilter) {
    setFilterMenuOpen(false);
    if (next === filter) return;
    // A filtered selection or focus would point at items that just left the grid.
    setSelected(new Set());
    setFocusedId(null);
    setViewerIndex(null);
    setFilter(next);
  }

  return (
    <div className="desktop-library" data-testid="desktop-library">
      <div className="desktop-library__toolbar" data-testid="desktop-library-toolbar">
        <div className="desktop-library__zoom-slider">
          <button
            type="button"
            className="toolbar-button toolbar-button--small"
            aria-label="Zoom Out"
            title="Zoom Out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((previous) => Math.max(0, previous - 1))}
          >
            <Icon name="minus" size={12} />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={0}
            max={MAX_ZOOM_INDEX}
            value={zoomIndex}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <button
            type="button"
            className="toolbar-button toolbar-button--small"
            aria-label="Zoom In"
            title="Zoom In"
            disabled={zoomIndex === MAX_ZOOM_INDEX}
            onClick={() => setZoomIndex((previous) => Math.min(MAX_ZOOM_INDEX, previous + 1))}
          >
            <Icon name="plus" size={12} />
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
        <div className="desktop-library__spacer" />
        {fixedView === undefined && (
        <div ref={segmentRef} role="tablist" aria-label="Library zoom" className="segmented-control">
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
        )}
        <div ref={filterMenuRef} className="desktop-library__filter">
          <button
            type="button"
            className="toolbar-button"
            aria-haspopup="menu"
            aria-expanded={filterMenuOpen}
            aria-pressed={filter !== "all"}
            aria-label="Filter By"
            title="Filter By"
            onClick={() => setFilterMenuOpen((value) => !value)}
          >
            <Icon name="filter" size={16} filled={filter !== "all"} />
          </button>
          {filterMenuOpen && (
            <div className="desktop-library__filter-menu" role="menu" aria-label="Filter By">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === option.key}
                  onClick={() => chooseFilter(option.key)}
                >
                  <span className="desktop-library__filter-check">{filter === option.key ? "✓" : ""}</span>
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="toolbar-button"
          aria-label="Share"
          onClick={() => void handleShare()}
          disabled={!shareSupported || selected.size === 0}
          title={shareSupported ? "Share" : "Sharing isn't supported in this browser"}
        >
          <Icon name="share" size={16} />
        </button>
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
          <ZipStatus state={zip.state} jpeg={zip.jpeg} onJpegChange={zip.setJpeg} />
        )}
        <span className="desktop-library__selection-count" data-testid="selection-count">
          {selected.size > 0 ? `${selected.size} selected` : ""}
        </span>
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
      <div className="desktop-library__body">
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
        {dateRangeLabel && view !== "days" && (
          <div
            className="desktop-library__date-range"
            data-hidden={headerInBand || undefined}
            style={{ "--title-scrim": titleScrimProgress(scrollOffset) } as CSSProperties}
          >
            <div className="desktop-library__title-scrim" aria-hidden="true" />
            <DateTitle text={dateRangeLabel} className="desktop-library__title" testId="desktop-library-title" />
          </div>
        )}
        {items.length === 0 && error ? (
          <div className="desktop-library__empty" role="alert">
            <p>{albumMessages(album).error}</p>
            <button type="button" className="desktop-library__retry" onClick={retry}>
              Retry
            </button>
          </div>
        ) : items.length === 0 && done ? (
          <p className="desktop-library__empty">{albumMessages(album).empty}</p>
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
                  {row.items.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <div
                        key={item.id}
                        ref={(element) => setCellRef(item.id, element)}
                        data-asset-id={item.id}
                        // Focus lands here when the Viewer closes (D59); arrow keys bubble to the grid.
                        tabIndex={-1}
                        data-testid="library-cell"
                        role="option"
                        aria-selected={selected.has(item.id)}
                        data-selected={selected.has(item.id)}
                        data-flash={flashId === item.id ? "true" : undefined}
                        className="desktop-library__cell"
                        style={{ height: row.type === "feature" ? featureHeight(containerWidth, cellSize, gap) : cellSize }}
                        onClick={(event) => handleCellClick(event, item, index)}
                        onDoubleClick={() => handleOpen(item.id)}
                        onContextMenu={(event) => handleCellContextMenu(event, item.id)}
                      >
                        <FadeImage
                          src={`/api/libraries/${libraryId}/thumb/${item.id}?size=${thumbSize}`}
                          alt={assetAlt(item)}
                          loading="lazy"
                          draggable={false}
                          className="desktop-library__thumb"
                          style={{ objectFit: squareMode ? "cover" : "contain" }}
                        />
                        {row.type === "feature" && <div className="desktop-library__feature-caption">{row.label}</div>}
                        <TileOverlays item={item} tileWidth={tileWidth} prefix="desktop-library" />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {items.length > 0 && error && (
          <div className="desktop-library__load-error" role="alert">
            <span>Couldn't load more photos.</span>
            <button type="button" className="desktop-library__retry" onClick={retry}>
              Retry
            </button>
          </div>
        )}
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
