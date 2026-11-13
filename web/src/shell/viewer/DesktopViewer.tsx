import { type CSSProperties, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { assetAlt } from "../assetAlt";
import { Icon } from "../icons";
import { copyAssetLink, downloadVersion } from "./download";
import MiniMap from "../map/MiniMap";
import { InfoRows, OriginalMissingNote, OriginalOutsideNote } from "./InfoRows";
import { useAssetDetail } from "./useAssetDetail";
import { useViewerMedia } from "./useViewerMedia";
import { thumbnailFor, useFocusScope } from "./focusScope";
import { prefersReducedMotion, useDismiss } from "./useDismiss";
import { usePreloadNeighbours } from "./usePreloadNeighbours";
import { useZoomTransition } from "./useZoomTransition";
import { gridThumbUrl, previewThumbUrl } from "./mediaUrls";
import { ViewerStill } from "./ViewerStill";
import * as g from "./gestures";
import { buildInfoRows, formatPlaceName } from "./viewerInfo";
import { formatDesktopTitle } from "./viewerTitle";
import { useChromeVisibility } from "./useChromeVisibility";
import { viewerKeyAction } from "./viewerKeys";

export interface ViewerProps {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  // #220: scroll the grid behind so this item's tile is on screen; called as
  // paging moves on, so the close zoom has a tile to land on.
  revealItem?: (id: string) => void;
}

// P1.16 desktop Viewer (no filmstrip, as in macOS Photos): double-click/wheel zoom with drag-to-pan,
// arrow keys and Esc, and a right-hand info panel (file name + size on top
// of the fields the mobile sheet shows). `items` is the Library view's own
// array -- Esc/arrows only ever move within it, so a hidden asset (P1.13)
// stays unreachable here exactly like it is from the grid.
const ZOOM_STEP = 0.5;

export default function DesktopViewer({ libraryId, items, index, onIndexChange, onClose: onCloseNow, revealItem }: ViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const item = items[index];
  // #220: zoom from / back into the tile of the item being shown.
  const { zoomOut } = useZoomTransition({ rootRef, stageRef, item });
  const { closing, dismiss } = useDismiss(onCloseNow, zoomOut);
  const onClose = useCallback(() => dismiss(), [dismiss]);
  const detail = useAssetDetail(libraryId, item?.id ?? null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const media = useViewerMedia(libraryId, item, detail?.has_edited, detail?.original_outside_library === true);
  usePreloadNeighbours(libraryId, items, index);

  const [infoOpen, setInfoOpen] = useState(false);
  // Playing video: the top bar fades after 2.5 s without pointer movement.
  const [videoRunning, setVideoRunning] = useState(false);
  const chrome = useChromeVisibility(media.isVideo && media.videoPlaying && videoRunning);
  const [view, setView] = useState<g.View>(g.FIT);
  const [animating, setAnimating] = useState(false);
  // #286: a page change slides (the neighbour follows the photo) for
  // PAGE_SETTLE_MS before the index moves; arrows and drags wait until then.
  const [paging, setPaging] = useState(false);
  const pageTimer = useRef<number | null>(null);
  const scale = view.scale;
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // D59: the grid behind is inert while the Viewer is open, and focus goes
  // back to the thumbnail it was opened from.
  const openedFromId = useRef(item?.id);
  const shownId = useRef(item?.id);
  shownId.current = item?.id;
  // The tile the close zoom lands on; the opener's if that one is gone.
  useFocusScope(rootRef, { restoreTo: () => thumbnailFor(shownId.current) ?? thumbnailFor(openedFromId.current) });

  const revealRef = useRef(revealItem);
  revealRef.current = revealItem;
  const firstItem = useRef(true);
  useEffect(() => {
    if (!item?.id) return;
    if (firstItem.current) firstItem.current = false;
    else revealRef.current?.(item.id);
  }, [item?.id]);

  useEffect(() => {
    setView(g.FIT);
    setAnimating(false);
    setPaging(false);
    setVideoRunning(false);
  }, [item?.id]);

  useEffect(
    () => () => {
      if (pageTimer.current !== null) window.clearTimeout(pageTimer.current);
    },
    [],
  );

  // Slide the strip the rest of the way, then move the index in the same
  // batch that recentres it. Reduced motion: switch at once, no slide.
  function commitPage(direction: "prev" | "next", width: number) {
    const nextIndex = direction === "next" ? index + 1 : index - 1;
    if (prefersReducedMotion()) {
      setAnimating(false);
      setView(g.FIT);
      onIndexChange(nextIndex);
      return;
    }
    setPaging(true);
    setView({ scale: 1, x: g.pageTarget(direction, width), y: 0 });
    pageTimer.current = window.setTimeout(() => {
      pageTimer.current = null;
      setPaging(false);
      setView(g.FIT);
      onIndexChange(nextIndex);
    }, g.PAGE_SETTLE_MS);
  }

  // Window-level, not the root div's onKeyDown: clicking the video play
  // button unmounts it, which drops focus to <body>, and a div-level
  // handler stops receiving keydowns once that happens. A window listener
  // keeps Esc/arrows working regardless of where focus lands, and it never
  // doubles up with DesktopLibrary's grid shortcuts -- those live on the
  // grid's own onKeyDown, which only fires while the grid itself holds focus.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      const action = viewerKeyAction(event, document.fullscreenElement);
      if (pageTimer.current !== null) return;
      if (action === "close") {
        onClose();
      } else if (action === "prev" && index > 0) {
        onIndexChange(index - 1);
      } else if (action === "next" && index < items.length - 1) {
        onIndexChange(index + 1);
      }
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  useEffect(() => {
    if (scale > 1.01) media.requestOriginal();
  }, [scale, media]);

  // Stage geometry (the still is centred in the stage and fills it, drawn
  // object-fit: contain), falling back to the window where layout is absent.
  function geometry() {
    const rect = stageRef.current?.getBoundingClientRect();
    const box = { w: rect?.width || window.innerWidth, h: rect?.height || window.innerHeight };
    const centre = { x: (rect?.left ?? 0) + box.w / 2, y: (rect?.top ?? 0) + box.h / 2 };
    const fit = g.fitSize({ w: item?.width ?? 0, h: item?.height ?? 0 }, box);
    return { box, centre, fit };
  }

  // Top-bar zoom: about the stage centre, through the same zoomView the wheel uses.
  function setZoom(next: number) {
    const { box, fit } = geometry();
    const scaleTo = g.clampZoom(next);
    setAnimating(false);
    setView(scaleTo <= g.ZOOM_MIN ? g.FIT : g.zoomView(viewRef.current, scaleTo, { x: 0, y: 0 }, fit, box));
  }

  function toggleZoom(event: MouseEvent) {
    const { box, centre, fit } = geometry();
    setAnimating(!prefersReducedMotion());
    setView((value) => g.toggleZoom(value, { x: event.clientX - centre.x, y: event.clientY - centre.y }, fit, box));
  }

  // Trackpad pinch arrives as ctrl+wheel. Added natively (not onWheel)
  // because React's wheel listener is passive and cannot stop the browser
  // zooming the whole page.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const { box, centre, fit } = geometry();
      const current = viewRef.current;
      const focal = { x: event.clientX - centre.x, y: event.clientY - centre.y };
      setAnimating(false);
      const next = g.zoomView(current, g.wheelScale(current.scale, event.deltaY), focal, fit, box);
      setView(next.scale <= g.ZOOM_MIN ? g.FIT : next);
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  });

  // #267: the drag follows the mouse on the window, so leaving the stage
  // mid-drag still pans (clamped at the edge) instead of freezing the photo.
  const endDragRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => endDragRef.current?.(), []);

  function onMediaMouseDown(event: MouseEvent) {
    if (event.button !== 0 || pageTimer.current !== null) return;
    event.preventDefault();
    setAnimating(false);
    endDragRef.current?.();
    const atFit = scale <= 1;
    dragRef.current = { startX: event.clientX, startY: event.clientY, panX: view.x, panY: view.y };
    let last = { dx: 0, dy: 0 };
    // At fit the hand only closes once the mouse moves, so a click or a
    // double-click to zoom never flashes it.
    if (!atFit) setDragging(true);
    const onMove = (move: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      last = { dx: move.clientX - drag.startX, dy: move.clientY - drag.startY };
      if (atFit) {
        if (g.lockAxis(last.dx, last.dy)) setDragging(true);
        const dragged = g.fitDragView(last);
        // Rubber band against the first and last photo.
        const x = g.pagingOffset(dragged.x, index > 0, index < items.length - 1, geometry().box.w);
        setView({ ...dragged, x });
        return;
      }
      const { box, fit } = geometry();
      const pan = g.clampPan({ x: drag.panX + last.dx, y: drag.panY + last.dy }, g.panBounds(viewRef.current.scale, fit, box));
      setView({ scale: viewRef.current.scale, ...pan });
    };
    const end = (up?: globalThis.MouseEvent | FocusEvent) => {
      if (atFit && (last.dx !== 0 || last.dy !== 0)) {
        const { box } = geometry();
        const outcome = up?.type === "mouseup" ? g.fitDragOutcome(last, box) : null;
        if (outcome === "prev" && index > 0) commitPage("prev", box.w);
        else if (outcome === "next" && index < items.length - 1) commitPage("next", box.w);
        else {
          // Spring back (or hand over to the close zoom, which starts from here).
          setAnimating(!prefersReducedMotion() && outcome !== "close");
          setView(g.FIT);
          if (outcome === "close") onClose();
        }
      }
      dragRef.current = null;
      endDragRef.current = null;
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("blur", end);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", end);
    window.addEventListener("blur", end);
    endDragRef.current = end;
  }

  function handleDownload() {
    if (detail?.original_outside_library) return;
    downloadVersion(libraryId, item.id, detail?.has_edited ? "edited" : "original");
  }

  function handleDownloadOriginal() {
    if (detail?.original_outside_library) return;
    downloadVersion(libraryId, item.id, "original");
  }

  function handleCopyLink() {
    void copyAssetLink(libraryId, item.id);
  }

  if (!item) return null;
  const infoRows = detail ? buildInfoRows(detail, { includeFile: true }) : [];
  const slide = paging ? `transform ${g.PAGE_SETTLE_MS}ms ${g.PAGE_SETTLE_EASE}` : undefined;
  // Horizontal offset of the neighbouring photos: they ride along with a fit
  // drag, and stay parked off-stage while zoomed.
  const pageX = scale <= 1 ? view.x : 0;
  const neighbourStyle = (side: -1 | 1): CSSProperties => ({
    transform: `translateX(calc(${side * 100}% + ${side * g.PAGE_GAP_PX}px + ${pageX}px))`,
    transition: slide ?? (animating ? `transform ${g.SPRING_BACK_MS}ms ease-out` : undefined),
  });
  const mediaTransform: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transition: slide ?? (animating ? `transform ${g.ZOOM_ANIM_MS}ms ease-out` : undefined),
    // #257: open hand when there is something to pan, closed while the button
    // is held, the plain arrow at fit (no click-to-zoom, only double-click).
    cursor: dragging ? "grabbing" : scale > 1 ? "grab" : "default",
  };
  const isFull = media.showingOriginal || media.wantsOriginal;
  const alt = assetAlt({ ...item, title: detail?.title });
  const stillSrc = media.showingOriginal ? media.showOriginalSrc : media.wantsOriginal ? media.originalSrc : media.previewSrc;
  const stillOnError = media.showingOriginal || media.wantsOriginal ? media.onOriginalError : undefined;
  const title = formatDesktopTitle({
    place: detail ? formatPlaceName(detail) : "",
    dateCreated: detail?.date_created ?? item.date ?? null,
    index,
    total: items.length,
  });

  return (
    <div
      className={`desktop-viewer${closing ? " is-closing" : ""}${dragging ? " is-dragging" : ""}`}
      data-testid="desktop-viewer"
      data-index={index}
      ref={rootRef}
      tabIndex={-1}
      onMouseMove={chrome.reveal}
    >
      <div className="desktop-viewer__main">
        <div className={`desktop-viewer__topbar${chrome.hidden ? " is-chrome-hidden" : ""}`}>
          <div className="desktop-viewer__topbar-left">
            <button type="button" className="toolbar-button desktop-viewer__back" onClick={onClose} aria-label="Back">
              <Icon name="chevron" size={16} className="icon-flip" />
            </button>
            <div className="desktop-viewer__zoom">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => setZoom(scale - ZOOM_STEP)}
                disabled={scale <= g.ZOOM_MIN}
                aria-label="Zoom Out"
              >
                <Icon name="minus" size={16} />
              </button>
              <input
                type="range"
                className="desktop-viewer__zoom-slider"
                min={g.ZOOM_MIN}
                max={g.ZOOM_MAX}
                step={0.01}
                value={scale}
                onChange={(event) => setZoom(Number(event.target.value))}
                aria-label="Zoom"
                data-testid="viewer-zoom-slider"
              />
              <button
                type="button"
                className="toolbar-button"
                onClick={() => setZoom(scale + ZOOM_STEP)}
                disabled={scale >= g.ZOOM_MAX}
                aria-label="Zoom In"
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>
          <div className="desktop-viewer__title" data-testid="viewer-title">
            <span className="desktop-viewer__title-primary">{title.primary}</span>
            {title.secondary && <span className="desktop-viewer__title-secondary">{title.secondary}</span>}
          </div>
          <div className="desktop-viewer__topbar-right">
            <button type="button" className="toolbar-button" onClick={handleCopyLink} aria-label="Copy Link">
              <Icon name="link" size={16} />
            </button>
            <button type="button" className="toolbar-button" onClick={handleDownload} aria-label="Download">
              <Icon name="download" size={16} />
            </button>
            {detail?.has_edited && (
              <button type="button" className="toolbar-button" onClick={handleDownloadOriginal} aria-label="Download Original">
                <Icon name="document" size={16} />
              </button>
            )}
            {detail?.has_edited && (
              <button
                type="button"
                className="toolbar-button"
                aria-pressed={media.showingOriginal}
                onClick={() => media.toggleShowOriginal()}
                aria-label="Show Original"
              >
                <Icon name="original" size={16} filled={media.showingOriginal} />
              </button>
            )}
            <button
              type="button"
              className="toolbar-button"
              aria-pressed={infoOpen}
              onClick={() => setInfoOpen((value) => !value)}
              aria-label="Info"
            >
              <Icon name="info" size={16} filled={infoOpen} />
            </button>
          </div>
        </div>
        <div
          className="desktop-viewer__stage"
          data-testid="desktop-viewer-stage"
          ref={stageRef}
        >
          {media.isVideo ? (
            media.videoPlaying ? (
              <video className="desktop-viewer__media" src={media.originalSrc} controls
                autoPlay
                onPlay={() => setVideoRunning(true)}
                onPause={() => setVideoRunning(false)}
                onEnded={() => setVideoRunning(false)}
                ref={videoRef}
                data-testid="viewer-video"
              />
            ) : (
              <button type="button" className="desktop-viewer__play-button" onClick={() => media.startVideo()} aria-label="Play video">
                <img className="desktop-viewer__media" src={media.previewSrc} alt={assetAlt({ ...item, title: detail?.title })} />
                <Icon name="play" size={56} className="mobile-viewer__play-icon" />
              </button>
            )
          ) : media.isLivePhoto ? (
            <div
              className="desktop-viewer__media-wrap"
              onMouseEnter={() => media.startLive()}
              onMouseLeave={() => media.stopLive()}
            >
              {media.livePlaying ? (
                <video
                  className="desktop-viewer__media"
                  src={media.liveVideoSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  data-testid="viewer-live-video"
                />
              ) : (
                <ViewerStill
                  imgClassName="desktop-viewer__media"
                  stillSrc={stillSrc}
                  previewSrc={media.previewSrc}
                  placeholderSrc={gridThumbUrl(libraryId, item.id)}
                  isFull={isFull}
                  alt={alt}
                  transform={mediaTransform}
                  onDoubleClick={toggleZoom}
                  onMouseDown={onMediaMouseDown}
                  onLoad={media.onPreviewLoaded}
                  onError={stillOnError}
                />
              )}
              <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
            </div>
          ) : (
            <ViewerStill
              imgClassName="desktop-viewer__media"
              stillSrc={stillSrc}
              previewSrc={media.previewSrc}
              placeholderSrc={gridThumbUrl(libraryId, item.id)}
              isFull={isFull}
              alt={alt}
              transform={mediaTransform}
              onDoubleClick={toggleZoom}
              onMouseDown={onMediaMouseDown}
              onLoad={media.onPreviewLoaded}
              onError={stillOnError}
            />
          )}
          {(["prev", "next"] as const).map((side) => {
            const other = items[index + (side === "prev" ? -1 : 1)];
            return (
              other && (
                <div key={side} className="desktop-viewer__neighbour" style={neighbourStyle(side === "prev" ? -1 : 1)} aria-hidden>
                  <img className="desktop-viewer__media" src={previewThumbUrl(libraryId, other.id)} alt="" draggable={false} />
                </div>
              )
            );
          })}
          <OriginalOutsideNote outside={detail?.original_outside_library} className="viewer-outside-banner" />
        </div>
      </div>
      {infoOpen && (
        <div className="desktop-viewer__info-panel" data-testid="viewer-info-panel">
          <OriginalMissingNote available={detail?.original_available} className="viewer-info-note desktop-viewer__info-note" />
          <InfoRows rows={infoRows} className="desktop-viewer__info-rows" />
          {detail?.latitude != null && detail.longitude != null && (
            <MiniMap latitude={detail.latitude} longitude={detail.longitude} />
          )}
        </div>
      )}
    </div>
  );
}
