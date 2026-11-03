import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { Icon } from "../icons";
import { Filmstrip } from "./Filmstrip";
import { InfoRows } from "./InfoRows";
import { useAssetDetail } from "./useAssetDetail";
import { useViewerMedia } from "./useViewerMedia";
import { buildInfoRows } from "./viewerInfo";

export interface ViewerProps {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const ZOOM_SCALE = 2.5;

// P1.16 desktop Viewer: filmstrip, double-click/wheel zoom with drag-to-pan,
// arrow keys and Esc, and a right-hand info panel (file name + size on top
// of the fields the mobile sheet shows). `items` is the Library view's own
// array -- Esc/arrows only ever move within it, so a hidden asset (P1.13)
// stays unreachable here exactly like it is from the grid.
export default function DesktopViewer({ libraryId, items, index, onIndexChange, onClose }: ViewerProps) {
  const item = items[index];
  const detail = useAssetDetail(libraryId, item?.id ?? null);
  const media = useViewerMedia(libraryId, item);

  const [infoOpen, setInfoOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [item?.id]);

  useEffect(() => {
    if (scale > 1.01) media.requestOriginal();
  }, [scale, media]);

  function toggleZoom() {
    setScale((value) => (value > 1 ? 1 : ZOOM_SCALE));
    setPan({ x: 0, y: 0 });
  }

  function onMediaMouseDown(event: MouseEvent) {
    if (scale <= 1) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onMediaMouseMove(event: MouseEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) });
  }

  function endDrag() {
    dragRef.current = null;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      onIndexChange(index - 1);
      return;
    }
    if (event.key === "ArrowRight" && index < items.length - 1) {
      onIndexChange(index + 1);
    }
  }

  function handleDownload() {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId}/original/${item.id}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!item) return null;
  const infoRows = detail ? buildInfoRows(detail, { includeFile: true }) : [];
  const mediaTransform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;

  return (
    <div
      className="desktop-viewer"
      data-testid="desktop-viewer"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="desktop-viewer__main">
        <div className="desktop-viewer__topbar">
          <button type="button" className="toolbar-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
          <div className="desktop-library__spacer" />
          <button type="button" className="toolbar-button" onClick={handleDownload} aria-label="Download">
            <Icon name="download" size={16} />
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-pressed={infoOpen}
            onClick={() => setInfoOpen((value) => !value)}
            aria-label="Info"
          >
            <Icon name="info" size={16} />
          </button>
        </div>
        <div
          className="desktop-viewer__stage"
          data-testid="desktop-viewer-stage"
          onMouseMove={onMediaMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          {media.isVideo ? (
            media.videoPlaying ? (
              <video className="desktop-viewer__media" src={media.originalSrc} controls autoPlay data-testid="viewer-video" />
            ) : (
              <button type="button" className="desktop-viewer__play-button" onClick={() => media.startVideo()} aria-label="Play video">
                <img className="desktop-viewer__media" src={media.previewSrc} alt={item.filename ?? ""} />
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
                <img
                  className="desktop-viewer__media"
                  src={media.wantsOriginal ? media.originalSrc : media.previewSrc}
                  alt={item.filename ?? ""}
                  style={{ transform: mediaTransform, cursor: scale > 1 ? "grab" : "zoom-in" }}
                  onDoubleClick={toggleZoom}
                  onMouseDown={onMediaMouseDown}
                />
              )}
              <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
            </div>
          ) : (
            <img
              className="desktop-viewer__media"
              src={media.wantsOriginal ? media.originalSrc : media.previewSrc}
              alt={item.filename ?? ""}
              style={{ transform: mediaTransform, cursor: scale > 1 ? "grab" : "zoom-in" }}
              onDoubleClick={toggleZoom}
              onMouseDown={onMediaMouseDown}
            />
          )}
        </div>
        <Filmstrip
          libraryId={libraryId}
          items={items}
          index={index}
          onSelect={onIndexChange}
          className="desktop-viewer__filmstrip"
        />
      </div>
      {infoOpen && (
        <div className="desktop-viewer__info-panel" data-testid="viewer-info-panel">
          <InfoRows rows={infoRows} className="desktop-viewer__info-rows" />
        </div>
      )}
    </div>
  );
}
