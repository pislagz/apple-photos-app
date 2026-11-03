import { type TouchEvent, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { Icon } from "../icons";
import { shareOrDownloadAssets } from "./download";
import { Filmstrip } from "./Filmstrip";
import { InfoRows } from "./InfoRows";
import { useAssetDetail } from "./useAssetDetail";
import { useViewerMedia } from "./useViewerMedia";
import { buildInfoRows, formatDateLine, formatLocationLine } from "./viewerInfo";

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
export default function MobileViewer({ libraryId, items, index, onIndexChange, onClose }: ViewerProps) {
  const item = items[index];
  const detail = useAssetDetail(libraryId, item?.id ?? null);
  const media = useViewerMedia(libraryId, item);

  const [infoOpen, setInfoOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [dragY, setDragY] = useState(0);

  const gesture = useRef<{
    startX: number;
    startY: number;
    pinchStartDistance: number | null;
    pinchStartScale: number;
    lastTapTime: number;
  }>({ startX: 0, startY: 0, pinchStartDistance: null, pinchStartScale: 1, lastTapTime: 0 });

  useEffect(() => {
    setScale(1);
    setDragY(0);
    setInfoOpen(false);
  }, [item?.id]);

  useEffect(() => {
    if (scale > 1.01) media.requestOriginal();
  }, [scale, media]);

  function onTouchStart(event: TouchEvent) {
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
    }
  }

  function onTouchMove(event: TouchEvent) {
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
    void shareOrDownloadAssets(libraryId, [{ id: item.id, filename: item.filename }]);
  }

  if (!item) return null;
  const infoRows = detail ? buildInfoRows(detail) : [];
  const dateLine = detail ? formatDateLine(detail.date_created) : "";
  const placeLine = detail ? formatLocationLine(detail) : "";
  // ios17-viewer.png: place is the bold title, date is the subtitle below
  // it. When a photo has no place, the date becomes the title on its own.
  const titleLine = placeLine || dateLine;
  const subtitleLine = placeLine ? dateLine : "";

  return (
    <div className="mobile-viewer" data-testid="mobile-viewer" style={{ opacity: 1 - Math.min(dragY / 400, 0.6) }}>
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
              <img className="mobile-viewer__media" src={media.previewSrc} alt={item.filename ?? ""} />
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
                src={media.wantsOriginal ? media.originalSrc : media.previewSrc}
                alt={item.filename ?? ""}
                style={{ transform: `scale(${scale})` }}
                onError={media.wantsOriginal ? media.onOriginalError : undefined}
              />
            )}
            <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
          </div>
        ) : (
          <img
            className="mobile-viewer__media"
            src={media.wantsOriginal ? media.originalSrc : media.previewSrc}
            alt={item.filename ?? ""}
            style={{ transform: `scale(${scale})` }}
            onError={media.wantsOriginal ? media.onOriginalError : undefined}
          />
        )}
      </div>
      <Filmstrip libraryId={libraryId} items={items} index={index} onSelect={onIndexChange} className="mobile-viewer__filmstrip" />
      <div className="mobile-viewer__icon-row">
        {item.favorite && (
          <span className="mobile-viewer__icon-button" aria-label="Favorite">
            <Icon name="favorite" size={20} />
          </span>
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
          <Icon name="info" size={20} />
        </button>
      </div>
      {infoOpen && (
        <div className="mobile-viewer__info-sheet" data-testid="viewer-info-sheet">
          <button
            type="button"
            className="mobile-viewer__info-sheet-close"
            onClick={() => setInfoOpen(false)}
            aria-label="Close info"
          >
            <Icon name="close" size={16} />
          </button>
          <InfoRows rows={infoRows} className="mobile-viewer__info-rows" />
        </div>
      )}
    </div>
  );
}
