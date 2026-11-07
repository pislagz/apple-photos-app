import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type AssetListItem, getHidden } from "../api";
import { HiddenUnlock } from "./HiddenUnlock";
import DesktopViewer from "./viewer/DesktopViewer";
import MobileViewer from "./viewer/MobileViewer";

// Apple Photos' Hidden album (P1.13, #156): a thumbnail grid that opens the
// regular Viewer on the hidden list's own items, so a hidden asset never
// enters the Library grid's state. The album is small, so the grid is a plain
// CSS grid with a paging sentinel rather than the virtualized Library grid.
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
  const probing = useRef(false);
  const rendered = items !== null && !locked && !failed;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onImageError = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement) && !(event.target instanceof HTMLVideoElement)) return;
      if (probing.current) return;
      probing.current = true;
      getHidden(libraryId, null, 1)
        .catch((err) => {
          if (isHiddenLocked(err)) setLocked(true);
        })
        .finally(() => {
          probing.current = false;
        });
    };
    root.addEventListener("error", onImageError, true);
    return () => root.removeEventListener("error", onImageError, true);
  }, [libraryId, rendered]);

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
      <div className="hidden-view__grid" data-testid="hidden-grid">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="hidden-view__cell"
            aria-label={item.filename ?? "Open photo"}
            onClick={() => setOpenIndex(index)}
          >
            <img
              src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`}
              alt={item.filename ?? ""}
              loading="lazy"
              className="hidden-view__thumb"
            />
          </button>
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
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}
