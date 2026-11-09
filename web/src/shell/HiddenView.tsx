import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, type AssetListItem, getHidden } from "../api";
import { assetAlt } from "./assetAlt";
import { HiddenUnlock } from "./HiddenUnlock";
import DesktopViewer from "./viewer/DesktopViewer";
import MobileViewer from "./viewer/MobileViewer";

// Apple Photos' Hidden album (P1.13, #156): a thumbnail grid that opens the
// regular Viewer on the hidden list's own items, so a hidden asset never
// enters the Library grid's state. The grid is virtualized by row (the root is
// its own scroller) with a paging sentinel after the last row; the Viewer also
// pages when you swipe/arrow to the end of what is loaded.
//
// #148/#150: the server re-locks Hidden (5 idle minutes, or another tab
// leaving) and answers 403 `hidden_locked` on the list, thumbs, originals and
// detail. A list/page 403 shows the password prompt in place. Images can't
// expose their status, so a failed <img> anywhere in the grid or Viewer
// re-probes the list: if that 403s `hidden_locked` the prompt shows, otherwise
// the broken image is left alone. A successful unlock reloads from the top.
function isHiddenLocked(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === "hidden_locked";
}

// Minimum cell size and gap/padding per layout; mirrors the old CSS auto-fill grid.
const GRID = {
  mobile: { min: 96, gap: 2, pad: 0 },
  desktop: { min: 160, gap: 4, pad: 8 },
} as const;
// Failed images re-probe the list at most this often; extra failures in the
// window collapse into one trailing probe (#174).
const FALLBACK_HEIGHT = 800;
export const PROBE_MIN_INTERVAL_MS = 2000;

export default function HiddenView({
  libraryId,
  variant,
  onCancel,
}: {
  libraryId: number;
  variant: "mobile" | "desktop";
  onCancel: () => void;
}) {
  const [items, setItems] = useState<AssetListItem[] | null>(null);
  const [done, setDone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const generationRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    (first: boolean) => {
      const generation = generationRef.current;
      loadingRef.current = true;
      setPageFailed(false);
      getHidden(libraryId, first ? null : cursorRef.current)
        .then((response) => {
          if (generation !== generationRef.current) return;
          cursorRef.current = response.next_cursor;
          setDone(!response.next_cursor);
          setItems((previous) => (first || previous === null ? response.items : [...previous, ...response.items]));
        })
        .catch((err) => {
          if (generation !== generationRef.current) return;
          if (isHiddenLocked(err)) setLocked(true);
          else if (first) setFailed(true);
          else setPageFailed(true);
        })
        .finally(() => {
          if (generation === generationRef.current) loadingRef.current = false;
        });
    },
    [libraryId],
  );

  useEffect(() => {
    generationRef.current += 1;
    cursorRef.current = null;
    fetchPage(true);
    return () => {
      generationRef.current += 1;
    };
  }, [fetchPage, reloadKey]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || done || locked) return;
    fetchPage(false);
  }, [done, locked, fetchPage]);

  function reload() {
    setLocked(false);
    setFailed(false);
    setPageFailed(false);
    setDone(false);
    setItems(null);
    setOpenIndex(null);
    setReloadKey((key) => key + 1);
  }

  // Probe on any failed image (error doesn't bubble, so listen in capture).
  // One probe at a time, at most one per PROBE_MIN_INTERVAL_MS; failures that
  // arrive meanwhile share a single trailing probe, so a grid of broken thumbs
  // does not mean a probe per image.
  const rendered = items !== null && !locked && !failed;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let inFlight = false;
    let lastStart = -Infinity;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const probe = () => {
      inFlight = true;
      lastStart = Date.now();
      getHidden(libraryId, null, 1)
        .catch((err) => {
          if (!disposed && isHiddenLocked(err)) setLocked(true);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const schedule = (delay: number) => {
      trailing = setTimeout(() => {
        trailing = null;
        // Retry shortly if the previous probe is still out: its answer may
        // predate this failure.
        if (inFlight) schedule(200);
        else probe();
      }, delay);
    };
    const onImageError = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement) && !(event.target instanceof HTMLVideoElement)) return;
      if (trailing !== null) return;
      const wait = lastStart + PROBE_MIN_INTERVAL_MS - Date.now();
      if (!inFlight && wait <= 0) {
        probe();
        return;
      }
      schedule(Math.max(wait, 0));
    };
    root.addEventListener("error", onImageError, true);
    return () => {
      disposed = true;
      if (trailing !== null) clearTimeout(trailing);
      root.removeEventListener("error", onImageError, true);
    };
  }, [libraryId, rendered]);

  // Grid geometry from the scroller's width (0 before layout/in jsdom: use a
  // nominal width so the first rows still render).
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setWidth(root.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rendered]);
  const { min, gap, pad } = GRID[variant];
  const inner = Math.max((width || 4 * min) - 2 * pad, min);
  const columns = Math.max(1, Math.floor((inner + gap) / (min + gap)));
  const cell = (inner - gap * (columns - 1)) / columns;
  const rowCount = Math.ceil((items?.length ?? 0) / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => rootRef.current,
    estimateSize: () => cell + gap,
    overscan: 5,
    // An unlaid-out scroller (0 high: jsdom, display:none) would render no rows
    // at all; assume a screenful until a real measurement arrives.
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => cb(rect.height === 0 ? { ...rect, height: FALLBACK_HEIGHT } : rect)),
    paddingStart: pad,
    paddingEnd: pad,
  });

  // The virtualizer caches row sizes; re-measure when the cell size changes.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [cell, rowVirtualizer]);

  function changeIndex(next: number) {
    setOpenIndex(next);
    // Swiping/arrowing to the last loaded photo fetches the next page (#174).
    if (items && next >= items.length - 1) loadMore();
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, items, pageFailed]);

  if (locked) {
    return <HiddenUnlock variant={variant} onUnlocked={reload} onCancel={onCancel} />;
  }

  if (failed) {
    return (
      <div className="hidden-view hidden-view--error" role="alert">
        <p>Couldn't load hidden photos.</p>
        <button type="button" className="hidden-view__retry" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="hidden-view">
        <p>No hidden photos.</p>
      </div>
    );
  }

  const Viewer = variant === "mobile" ? MobileViewer : DesktopViewer;
  return (
    <div ref={rootRef} className={`hidden-view hidden-view--${variant}`}>
      <div
        className="hidden-view__grid"
        data-testid="hidden-grid"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="hidden-view__row"
            style={{
              transform: `translateY(${row.start}px)`,
              height: cell,
              left: pad,
              right: pad,
              gap,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {items.slice(row.index * columns, (row.index + 1) * columns).map((item, offset) => (
              <button
                key={item.id}
                type="button"
                className="hidden-view__cell"
                aria-label={assetAlt(item)}
                onClick={() => setOpenIndex(row.index * columns + offset)}
              >
                <img
                  src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`}
                  alt={assetAlt(item)}
                  loading="lazy"
                  className="hidden-view__thumb"
                />
              </button>
            ))}
          </div>
        ))}
      </div>
      {pageFailed ? (
        <div className="hidden-view--error" role="alert">
          <span>Couldn't load more photos.</span>
          <button type="button" className="hidden-view__retry" onClick={loadMore}>
            Retry
          </button>
        </div>
      ) : (
        !done && <div ref={sentinelRef} className="hidden-view__sentinel" data-testid="hidden-sentinel" />
      )}
      {openIndex !== null && (
        <Viewer
          libraryId={libraryId}
          items={items}
          index={openIndex}
          onIndexChange={changeIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
