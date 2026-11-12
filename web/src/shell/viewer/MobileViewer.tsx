import { type TouchEvent, useEffect, useRef, useState } from "react";
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
import { useDismiss } from "./useDismiss";
import { viewerKeyAction } from "./viewerKeys";
import { buildInfoRows, formatDateLine, formatPlaceName } from "./viewerInfo";

export interface ViewerProps {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const SWIPE_DISMISS_PX = 100;
const SWIPE_NAV_PX = 60;
const DOUBLE_TAP_MS = 300;
const LONG_PRESS_MS = 450;
const ZOOM_SCALE = 2.5;

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
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
  const [scale, setScale] = useState(1);
  const [dragY, setDragY] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const gesture = useRef<{
    startX: number;
    startY: number;
    pinchStartDistance: number | null;
    pinchStartScale: number;
    lastTapTime: number;
  }>({ startX: 0, startY: 0, pinchStartDistance: null, pinchStartScale: 1, lastTapTime: 0 });
  const longPressTimer = useRef<number | null>(null);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  useEffect(() => {
    setScale(1);
    setDragY(0);
    setInfoOpen(false);
    clearLongPress();
  }, [item?.id]);

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

  function onTouchStart(event: TouchEvent) {
    clearLongPress();
    if (event.touches.length === 2) {
      gesture.current.pinchStartDistance = distance(event.touches[0], event.touches[1]);
      gesture.current.pinchStartScale = scale;
      return;
    }
    const touch = event.touches[0];
    gesture.current.startX = touch.clientX;
    gesture.current.startY = touch.clientY;
    const now = Date.now();
    if (now - gesture.current.lastTapTime < DOUBLE_TAP_MS) {
      setScale((value) => (value > 1 ? 1 : ZOOM_SCALE));
      gesture.current.lastTapTime = 0;
    } else {
      gesture.current.lastTapTime = now;
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
    if (event.touches.length === 2 && gesture.current.pinchStartDistance) {
      const current = distance(event.touches[0], event.touches[1]);
      const ratio = current / gesture.current.pinchStartDistance;
      setScale(Math.min(4, Math.max(1, gesture.current.pinchStartScale * ratio)));
      return;
    }
    if (scale > 1) return;
    const touch = event.touches[0];
    const dy = touch.clientY - gesture.current.startY;
    if (dy > 0) setDragY(dy);
  }

  function onTouchEnd(event: TouchEvent) {
    clearLongPress();
    media.stopShowOriginal();
    if (event.touches.length > 0) return;
    gesture.current.pinchStartDistance = null;
    if (scale > 1) return;
    if (dragY > SWIPE_DISMISS_PX) {
      onClose();
      return;
    }
    setDragY(0);
    const dx = (event.changedTouches[0]?.clientX ?? gesture.current.startX) - gesture.current.startX;
    const dy = (event.changedTouches[0]?.clientY ?? gesture.current.startY) - gesture.current.startY;
    if (Math.abs(dy) > Math.abs(dx) && dy < -SWIPE_DISMISS_PX) {
      setInfoOpen(true);
      return;
    }
    if (dx < -SWIPE_NAV_PX && index < items.length - 1) {
      onIndexChange(index + 1);
    } else if (dx > SWIPE_NAV_PX && index > 0) {
      onIndexChange(index - 1);
    }
  }

  function handleShare() {
    if (detail?.original_outside_library) return;
    void shareOrDownloadAssets(libraryId, [{ id: item.id, filename: item.filename, original_filename: item.original_filename }]);
  }

  function handleDownloadOriginal() {
    if (detail?.original_outside_library) return;
    downloadVersion(libraryId, item.id, "original");
  }

  if (!item) return null;
  const stillSrc = media.showingOriginal ? media.showOriginalSrc : media.wantsOriginal ? media.originalSrc : media.previewSrc;
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
      style={{ opacity: 1 - Math.min(dragY / 400, 0.6) }}>
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
        style={{ transform: `translateY(${dragY}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
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
              <img className="mobile-viewer__media" src={media.previewSrc} alt={assetAlt({ ...item, title: detail?.title })} draggable={false} />
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
              <img
                className="mobile-viewer__media"
                src={stillSrc}
                alt={assetAlt({ ...item, title: detail?.title })}
                style={{ transform: `scale(${scale})` }}
                onLoad={media.onPreviewLoaded}
                onError={stillOnError}
                draggable={false}
              />
            )}
            <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
          </div>
        ) : (
          <img
            className="mobile-viewer__media"
            src={stillSrc}
            alt={assetAlt({ ...item, title: detail?.title })}
            style={{ transform: `scale(${scale})` }}
            onLoad={media.onPreviewLoaded}
            onError={stillOnError}
            draggable={false}
          />
        )}
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
