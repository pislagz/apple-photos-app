import { type CSSProperties, type TouchEvent, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { assetAlt } from "../assetAlt";
import { Icon } from "../icons";
import { downloadVersion, shareOrDownloadAssets } from "./download";
import { Filmstrip } from "./Filmstrip";
import MiniMap from "../map/MiniMap";
import { InfoRows, OriginalMissingNote, OriginalOutsideNote } from "./InfoRows";
import { useAssetDetail } from "./useAssetDetail";
import { useViewerMedia } from "./useViewerMedia";
import { thumbnailFor, useFocusScope } from "./focusScope";
import { prefersReducedMotion, useDismiss } from "./useDismiss";
import { ViewerStill } from "./ViewerStill";
import { previewThumbUrl } from "./mediaUrls";
import * as g from "./gestures";
import { viewerKeyAction } from "./viewerKeys";
import { buildInfoRows, formatDateLine, formatPlaceName } from "./viewerInfo";

export interface ViewerProps {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const LONG_PRESS_MS = 450;

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

type Mode = "none" | "undecided" | "page" | "dismiss" | "swipeup" | "pan" | "pinch";

interface Gesture {
  mode: Mode;
  startX: number;
  startY: number;
  samples: g.Sample[];
  view0: g.View;
  pinchD0: number;
  pinchMid0: g.Point;
  lastTapTime: number;
  lastTapX: number;
  lastTapY: number;
  dx: number;
  dy: number;
}

// P1.16 mobile Viewer (ios17-viewer.png): full-bleed stage, swipe
// left/right between items (the order of whatever view opened it --
// `items` is that view's own array, so a hidden asset from Library (P1.13)
// can never appear here), swipe down to dismiss, pinch/double-tap zoom,
// bottom filmstrip, and an info sheet instead of a permanent panel.
export default function MobileViewer({ libraryId, items, index, onIndexChange, onClose: onCloseNow }: ViewerProps) {
  const { closing, dismiss: onClose } = useDismiss(onCloseNow);
  const item = items[index];
  const detail = useAssetDetail(libraryId, item?.id ?? null);
  const media = useViewerMedia(libraryId, item, detail?.has_edited, detail?.original_outside_library === true);

  const [infoOpen, setInfoOpen] = useState(false);
  const [view, setView] = useState<g.View>(g.FIT);
  // Finger offset of the three-page strip, and of a dismiss drag.
  const [pageDx, setPageDx] = useState(0);
  const [drag, setDrag] = useState<g.Point>({ x: 0, y: 0 });
  // True while a release (settle, spring-back, tap zoom) animates.
  const [animating, setAnimating] = useState(false);
  const scale = view.scale;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // D59: the library behind is inert while the Viewer is open; focus goes back
  // to the thumbnail it was opened from.
  const openedFromId = useRef(item?.id);
  useFocusScope(rootRef, { restoreTo: () => thumbnailFor(openedFromId.current) });
  // D23/D59: the Info sheet covers the toolbar and filmstrip, so while it is
  // open only the sheet is reachable; closing it puts focus back on Info.
  useFocusScope(sheetRef, {
    active: infoOpen,
    initialFocus: () => sheetRef.current?.querySelector<HTMLElement>("button") ?? null,
  });

  const gesture = useRef<Gesture>({
    mode: "none",
    startX: 0,
    startY: 0,
    samples: [],
    view0: g.FIT,
    pinchD0: 0,
    pinchMid0: { x: 0, y: 0 },
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    dx: 0,
    dy: 0,
  });
  const committing = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  useEffect(() => {
    setView(g.FIT);
    setDrag({ x: 0, y: 0 });
    setPageDx(0);
    setAnimating(false);
    setInfoOpen(false);
    clearLongPress();
  }, [item?.id]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  // External keyboards (iPad): Esc closes, like the desktop viewer.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      if (viewerKeyAction(event, document.fullscreenElement) === "close") onClose();
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (scale > 1.01) media.requestOriginal();
  }, [scale, media]);

  // Stage geometry, falling back to the window where layout is unavailable.
  function stageBox(): { box: g.Size; centre: g.Point } {
    const rect = stageRef.current?.getBoundingClientRect();
    const w = rect?.width || window.innerWidth;
    const h = rect?.height || window.innerHeight;
    return { box: { w, h }, centre: { x: (rect?.left ?? 0) + w / 2, y: (rect?.top ?? 0) + h / 2 } };
  }

  function fitOf(box: g.Size): g.Size {
    return g.fitSize({ w: item?.width ?? 0, h: item?.height ?? 0 }, box);
  }

  function rel(point: TouchPoint, centre: g.Point): g.Point {
    return { x: point.clientX - centre.x, y: point.clientY - centre.y };
  }

  function midpoint(a: TouchPoint, b: TouchPoint, centre: g.Point): g.Point {
    return rel({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }, centre);
  }

  function animate(next: () => void) {
    setAnimating(!prefersReducedMotion());
    next();
  }

  function onTouchStart(event: TouchEvent) {
    clearLongPress();
    if (committing.current) return;
    const state = gesture.current;
    const { centre } = stageBox();
    setAnimating(false);
    if (event.touches.length === 2) {
      state.mode = "pinch";
      state.pinchD0 = distance(event.touches[0], event.touches[1]);
      state.pinchMid0 = midpoint(event.touches[0], event.touches[1], centre);
      state.view0 = view;
      return;
    }
    const touch = event.touches[0];
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.dx = 0;
    state.dy = 0;
    state.samples = [{ x: touch.clientX, y: touch.clientY, t: Date.now() }];
    state.view0 = view;
    state.mode = view.scale > g.ZOOM_MIN + 0.01 ? "pan" : "undecided";
    const now = Date.now();
    const nearLastTap =
      Math.hypot(touch.clientX - state.lastTapX, touch.clientY - state.lastTapY) < g.DOUBLE_TAP_SLOP_PX;
    if (now - state.lastTapTime < g.DOUBLE_TAP_MS && nearLastTap) {
      const { box } = stageBox();
      animate(() => setView((value) => g.toggleZoom(value, rel(touch, centre), fitOf(box), box)));
      state.lastTapTime = 0;
      state.mode = "none";
    } else {
      state.lastTapTime = now;
      state.lastTapX = touch.clientX;
      state.lastTapY = touch.clientY;
      // Apple Photos' press-and-hold "Show Original" (P1.17b fix round):
      // only armed for an edited asset, and cleared by any subsequent
      // touchstart/move/end so a swipe or double-tap never triggers it.
      if (detail?.has_edited) {
        longPressTimer.current = window.setTimeout(() => {
          media.startShowOriginal();
        }, LONG_PRESS_MS);
      }
    }
  }

  function onTouchMove(event: TouchEvent) {
    clearLongPress();
    const state = gesture.current;
    if (committing.current) return;
    const { box, centre } = stageBox();
    if (event.touches.length === 2 && state.mode === "pinch" && state.pinchD0 > 0) {
      const ratio = distance(event.touches[0], event.touches[1]) / state.pinchD0;
      const mid = midpoint(event.touches[0], event.touches[1], centre);
      // Zoom about the pinch midpoint, and follow the midpoint as it moves.
      const zoomed = g.zoomView(
        { ...state.view0, x: state.view0.x + (mid.x - state.pinchMid0.x), y: state.view0.y + (mid.y - state.pinchMid0.y) },
        state.view0.scale * ratio,
        mid,
        fitOf(box),
        box,
      );
      setView(zoomed);
      return;
    }
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    state.dx = dx;
    state.dy = dy;
    state.samples.push({ x: touch.clientX, y: touch.clientY, t: Date.now() });
    if (state.samples.length > 12) state.samples.shift();
    if (state.mode === "undecided") {
      const axis = g.lockAxis(dx, dy);
      if (!axis) return;
      state.mode = axis === "horizontal" ? "page" : dy > 0 ? "dismiss" : "swipeup";
    }
    if (state.mode === "page") {
      setPageDx(g.pagingOffset(dx, index > 0, index < items.length - 1, box.w));
    } else if (state.mode === "dismiss") {
      setDrag({ x: dx, y: Math.max(0, dy) });
    } else if (state.mode === "pan") {
      const bounds = g.panBounds(state.view0.scale, fitOf(box), box);
      setView({ scale: state.view0.scale, ...g.clampPan({ x: state.view0.x + dx, y: state.view0.y + dy }, bounds) });
    }
  }

  function commitPage(decision: g.PageDecision, width: number) {
    const target = g.pageTarget(decision, width);
    const nextIndex = decision === "next" ? index + 1 : index - 1;
    if (prefersReducedMotion()) {
      setPageDx(0);
      onIndexChange(nextIndex);
      return;
    }
    committing.current = true;
    setAnimating(true);
    setPageDx(target);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      committing.current = false;
      // One batch: the strip jumps back to centre as the new item takes it.
      setAnimating(false);
      setPageDx(0);
      onIndexChange(nextIndex);
    }, g.PAGE_SETTLE_MS);
  }

  function onTouchEnd(event: TouchEvent) {
    clearLongPress();
    media.stopShowOriginal();
    const state = gesture.current;
    if (event.touches.length > 0) {
      if (state.mode === "pinch") {
        // One finger left after a pinch: settle the zoom, then pan with it.
        const { box } = stageBox();
        const settled = g.settleView(view, fitOf(box), box);
        animate(() => setView(settled));
        const rest = event.touches[0];
        state.startX = rest.clientX;
        state.startY = rest.clientY;
        state.view0 = settled;
        state.mode = settled.scale > g.ZOOM_MIN + 0.01 ? "pan" : "none";
      }
      return;
    }
    if (committing.current) return;
    const { box } = stageBox();
    const mode = state.mode;
    state.mode = "none";
    if (mode === "pinch") {
      animate(() => setView((value) => g.settleView(value, fitOf(box), box)));
      return;
    }
    const velocity = g.velocityOf(state.samples);
    if (mode === "page") {
      const decision = g.pageDecision(state.dx, velocity.x, box.w, index > 0, index < items.length - 1);
      if (decision === "stay") {
        animate(() => setPageDx(0));
      } else {
        commitPage(decision, box.w);
      }
    } else if (mode === "dismiss") {
      if (g.shouldDismiss(state.dy, velocity.y)) {
        onClose();
      } else {
        animate(() => setDrag({ x: 0, y: 0 }));
      }
    } else if (mode === "swipeup") {
      if (state.dy < -g.INFO_SWIPE_UP_PX) setInfoOpen(true);
    }
  }

  function handleShare() {
    if (detail?.original_outside_library) return;
    void shareOrDownloadAssets(libraryId, [{ id: item.id, filename: item.filename }]);
  }

  function handleDownloadOriginal() {
    if (detail?.original_outside_library) return;
    downloadVersion(libraryId, item.id, "original");
  }

  if (!item) return null;
  const stillSrc = media.showingOriginal ? media.showOriginalSrc : media.wantsOriginal ? media.originalSrc : media.previewSrc;
  const isFull = media.showingOriginal || media.wantsOriginal;
  const alt = assetAlt({ ...item, title: detail?.title });
  const zoomStyle: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transition: animating ? `transform ${g.ZOOM_ANIM_MS}ms ease-out` : undefined,
  };
  // The strip holds previous / current / next (laid out by CSS `order`; the
  // current page comes first in the DOM). Neighbours only load previews.
  const neighbours = {
    prev: index > 0 ? previewThumbUrl(libraryId, items[index - 1].id) : null,
    next: index < items.length - 1 ? previewThumbUrl(libraryId, items[index + 1].id) : null,
  };
  const stripStyle: CSSProperties = {
    transform: `translateX(calc(-100% - ${g.PAGE_GAP_PX}px + ${pageDx}px))`,
    transition: animating ? `transform ${g.PAGE_SETTLE_MS}ms ${g.PAGE_SETTLE_EASE}` : undefined,
  };
  // Swipe-down dismiss: the photo follows the finger and shrinks, the
  // background and chrome fade out (to nothing at DISMISS_FADE_PX).
  const look = g.dismissLook(drag.y);
  const dismissing = drag.x !== 0 || drag.y !== 0;
  const springTransition = animating ? `${g.SPRING_BACK_MS}ms ease-out` : "0s";
  const stageStyle: CSSProperties | undefined = dismissing
    ? { transform: `translate(${drag.x}px, ${drag.y}px) scale(${look.scale})`, transition: animating ? `transform ${springTransition}` : undefined }
    : animating
      ? { transition: `transform ${springTransition}` }
      : undefined;
  const rootStyle = dismissing || animating
    ? ({
        backgroundColor: `color-mix(in srgb, var(--color-bg) ${look.background * 100}%, transparent)`,
        "--viewer-chrome-alpha": look.background,
        transition: animating ? `background-color ${springTransition}` : undefined,
      } as CSSProperties)
    : undefined;
  const stillOnError = media.showingOriginal || media.wantsOriginal ? media.onOriginalError : undefined;
  const infoRows = detail ? buildInfoRows(detail) : [];
  const dateLine = detail ? formatDateLine(detail.date_created) : "";
  const placeLine = detail ? formatPlaceName(detail) : "";
  // ios17-viewer.png: place is the bold title, date is the subtitle below
  // it. When a photo has no place, the date becomes the title on its own.
  const titleLine = placeLine || dateLine;
  const subtitleLine = placeLine ? dateLine : "";

  return (
    <div
      className={`mobile-viewer${closing ? " is-closing" : ""}`}
      data-testid="mobile-viewer"
      ref={rootRef}
      tabIndex={-1}
      style={rootStyle}>
      <div className="mobile-viewer__topbar">
        <button type="button" className="mobile-viewer__icon-button" onClick={onClose} aria-label="Close">
          <Icon name="chevron" size={20} className="mobile-viewer__back-chevron" />
        </button>
        <div className="mobile-viewer__title">
          {titleLine && <div className="mobile-viewer__title-primary">{titleLine}</div>}
          {subtitleLine && <div className="mobile-viewer__title-secondary">{subtitleLine}</div>}
        </div>
        <button type="button" className="mobile-viewer__icon-button" aria-label="More">
          <Icon name="more" size={18} />
        </button>
      </div>
      <div
        className="mobile-viewer__stage"
        data-testid="mobile-viewer-stage"
        ref={stageRef}
        style={stageStyle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="mobile-viewer__strip" style={stripStyle}>
        <div className="mobile-viewer__page mobile-viewer__page--current">
        {media.isVideo ? (
          media.videoPlaying ? (
            <video
              className="mobile-viewer__media"
              src={media.originalSrc}
              controls
              autoPlay
              data-testid="viewer-video"
            />
          ) : (
            <button
              type="button"
              className="mobile-viewer__play-button"
              onClick={() => media.startVideo()}
              aria-label="Play video"
            >
              <img className="mobile-viewer__media" src={media.previewSrc} alt={alt} draggable={false} />
              <Icon name="play" size={48} className="mobile-viewer__play-icon" />
            </button>
          )
        ) : media.isLivePhoto ? (
          <div
            className="mobile-viewer__media-wrap"
            onPointerDown={() => media.startLive()}
            onPointerUp={() => media.stopLive()}
            onPointerCancel={() => media.stopLive()}
          >
            {media.livePlaying ? (
              <video
                className="mobile-viewer__media"
                src={media.liveVideoSrc}
                autoPlay
                muted
                loop
                playsInline
                data-testid="viewer-live-video"
              />
            ) : (
              <ViewerStill
                imgClassName="mobile-viewer__media"
                stillSrc={stillSrc}
                previewSrc={media.previewSrc}
                isFull={isFull}
                alt={alt}
                transform={zoomStyle}
                onLoad={media.onPreviewLoaded}
                onError={stillOnError}
              />
            )}
            <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
          </div>
        ) : (
          <ViewerStill
            imgClassName="mobile-viewer__media"
            stillSrc={stillSrc}
            previewSrc={media.previewSrc}
            isFull={isFull}
            alt={alt}
            transform={zoomStyle}
            onLoad={media.onPreviewLoaded}
            onError={stillOnError}
          />
        )}
        </div>
        <div className="mobile-viewer__page mobile-viewer__page--prev" aria-hidden>
          {neighbours.prev && <img className="mobile-viewer__media" src={neighbours.prev} alt="" draggable={false} />}
        </div>
        <div className="mobile-viewer__page mobile-viewer__page--next" aria-hidden>
          {neighbours.next && <img className="mobile-viewer__media" src={neighbours.next} alt="" draggable={false} />}
        </div>
        </div>
        {media.showingOriginal && (
          <span className="mobile-viewer__original-badge" data-testid="mobile-viewer-original-badge">
            Original
          </span>
        )}
        <OriginalOutsideNote outside={detail?.original_outside_library} className="viewer-outside-banner" />
      </div>
      <Filmstrip libraryId={libraryId} items={items} index={index} onSelect={onIndexChange} className="mobile-viewer__filmstrip" itemSize={44} />
      <div className="mobile-viewer__icon-row">
        {item.favorite && (
          <span className="mobile-viewer__status" role="img" aria-label="Favorite">
            <Icon name="favorite" size={20} filled />
          </span>
        )}
        {detail?.has_edited && (
          <button
            type="button"
            className="mobile-viewer__icon-button"
            onClick={handleDownloadOriginal}
            aria-label="Download Original"
          >
            <Icon name="document" size={20} />
          </button>
        )}
        <button type="button" className="mobile-viewer__icon-button" onClick={handleShare} aria-label="Share">
          <Icon name="share" size={20} />
        </button>
        <button
          type="button"
          className="mobile-viewer__icon-button"
          aria-pressed={infoOpen}
          onClick={() => setInfoOpen((value) => !value)}
          aria-label="Info"
        >
          <Icon name="info" size={20} filled={infoOpen} />
        </button>
      </div>
      {infoOpen && (
        <div className="mobile-viewer__info-sheet" data-testid="viewer-info-sheet" ref={sheetRef}>
          <button
            type="button"
            className="mobile-viewer__info-sheet-close"
            onClick={() => setInfoOpen(false)}
            aria-label="Close info"
          >
            <Icon name="close" size={16} />
          </button>
          <OriginalMissingNote available={detail?.original_available} className="viewer-info-note mobile-viewer__info-note" />
          <InfoRows rows={infoRows} className="mobile-viewer__info-rows" />
          {detail?.latitude != null && detail.longitude != null && (
            <MiniMap latitude={detail.latitude} longitude={detail.longitude} />
          )}
        </div>
      )}
    </div>
  );
}
