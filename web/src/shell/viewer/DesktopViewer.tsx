import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { AssetListItem } from "../../api";
import { assetAlt } from "../assetAlt";
import { Icon } from "../icons";
import { copyAssetLink, downloadVersion } from "./download";
import { Filmstrip } from "./Filmstrip";
import MiniMap from "../map/MiniMap";
import { InfoRows, OriginalMissingNote } from "./InfoRows";
import { useAssetDetail } from "./useAssetDetail";
import { useViewerMedia } from "./useViewerMedia";
import { useDismiss } from "./useDismiss";
import { buildInfoRows, formatDateLine, formatLocationLine } from "./viewerInfo";
import { viewerKeyAction } from "./viewerKeys";

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
export default function DesktopViewer({ libraryId, items, index, onIndexChange, onClose: onCloseNow }: ViewerProps) {
  const { closing, dismiss: onClose } = useDismiss(onCloseNow);
  const item = items[index];
  const detail = useAssetDetail(libraryId, item?.id ?? null);
  const media = useViewerMedia(libraryId, item, detail?.has_edited);

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

  // Window-level, not the root div's onKeyDown: clicking the video play
  // button unmounts it, which drops focus to <body>, and a div-level
  // handler stops receiving keydowns once that happens. A window listener
  // keeps Esc/arrows working regardless of where focus lands, and it never
  // doubles up with DesktopLibrary's grid shortcuts -- those live on the
  // grid's own onKeyDown, which only fires while the grid itself holds focus.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      const action = viewerKeyAction(event, document.fullscreenElement);
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

  function handleDownload() {
    downloadVersion(libraryId, item.id, detail?.has_edited ? "edited" : "original");
  }

  function handleDownloadOriginal() {
    downloadVersion(libraryId, item.id, "original");
  }

  function handleCopyLink() {
    void copyAssetLink(libraryId, item.id);
  }

  if (!item) return null;
  const infoRows = detail ? buildInfoRows(detail, { includeFile: true }) : [];
  const mediaTransform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
  const stillSrc = media.showingOriginal ? media.showOriginalSrc : media.wantsOriginal ? media.originalSrc : media.previewSrc;
  const stillOnError = media.showingOriginal || media.wantsOriginal ? media.onOriginalError : undefined;
  const dateLine = detail ? formatDateLine(detail.date_created) : "";
  const placeLine = detail ? formatLocationLine(detail) : "";
  // Same place-is-title convention as the mobile viewer (ios17-viewer.png);
  // no place falls back to the date as the sole title.
  const titleLine = placeLine || dateLine;
  const subtitleLine = placeLine ? dateLine : "";

  return (
    <div
      className={`desktop-viewer${closing ? " is-closing" : ""}`}
      data-testid="desktop-viewer"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="desktop-viewer__main">
        <div className="desktop-viewer__topbar">
          <button type="button" className="toolbar-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
          <div className="desktop-viewer__title">
            {titleLine && <span className="desktop-viewer__title-primary">{titleLine}</span>}
            {subtitleLine && <span className="desktop-viewer__title-secondary">{subtitleLine}</span>}
          </div>
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
              <Icon name="original" size={16} />
            </button>
          )}
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
                <img
                  className="desktop-viewer__media"
                  src={stillSrc}
                  alt={assetAlt({ ...item, title: detail?.title })}
                  style={{ transform: mediaTransform, cursor: scale > 1 ? "grab" : "zoom-in" }}
                  onDoubleClick={toggleZoom}
                  onMouseDown={onMediaMouseDown}
                  onLoad={media.onPreviewLoaded}
                  onError={stillOnError}
                />
              )}
              <Icon name="livephoto" size={18} className="mobile-viewer__live-badge" />
            </div>
          ) : (
            <img
              className="desktop-viewer__media"
              src={stillSrc}
              alt={assetAlt({ ...item, title: detail?.title })}
              style={{ transform: mediaTransform, cursor: scale > 1 ? "grab" : "zoom-in" }}
              onDoubleClick={toggleZoom}
              onMouseDown={onMediaMouseDown}
              onLoad={media.onPreviewLoaded}
              onError={stillOnError}
            />
          )}
        </div>
        <Filmstrip
          libraryId={libraryId}
          items={items}
          index={index}
          onSelect={onIndexChange}
          className="desktop-viewer__filmstrip"
          itemSize={52}
        />
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
