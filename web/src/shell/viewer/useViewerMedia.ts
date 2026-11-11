import { useEffect, useState } from "react";
import type { AssetListItem } from "../../api";
import { ORIGINAL_DWELL_MS } from "./gestures";
import { livePhotoVideoUrl, originalJpegFallbackUrl, originalUrl, previewThumbUrl } from "./mediaUrls";

// The acceptance rule in one place: every viewer surface renders the
// `preview` thumb first, and only asks for `/original` (`requestOriginal`,
// driven by deep zoom or an explicit download) or the live-photo video
// route (`startLive`, never the original still) once the user actually
// does something that needs them. Resets on every item change so paging
// through the filmstrip doesn't carry a zoomed/playing state to the next
// asset.
export interface ViewerMedia {
  previewSrc: string;
  originalSrc: string;
  liveVideoSrc: string;
  isVideo: boolean;
  isLivePhoto: boolean;
  wantsOriginal: boolean;
  requestOriginal: () => void;
  videoPlaying: boolean;
  startVideo: () => void;
  livePlaying: boolean;
  startLive: () => void;
  stopLive: () => void;
  // P1.17: a browser that can't decode HEIC fires `onError` on the full
  // image -- `onOriginalError` switches `originalSrc` to a server-side JPEG
  // transcode of the same file instead of leaving a broken image.
  onOriginalError: () => void;
  // P1.17b fix round: "Show Original" (phone long-press / Mac toolbar
  // toggle) always shows the unedited file, regardless of `wantsOriginal`'s
  // edited-by-default choice. A no-op when the asset was never edited.
  showingOriginal: boolean;
  showOriginalSrc: string;
  startShowOriginal: () => void;
  stopShowOriginal: () => void;
  toggleShowOriginal: () => void;
  // Fires once the preview thumb has actually rendered, so the viewer can
  // follow up with the full-quality file without waiting for a zoom -- but
  // skips that follow-up under the browser's data saver setting.
  onPreviewLoaded: () => void;
}

function isDataSaverOn(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export function useViewerMedia(
  libraryId: number,
  item: AssetListItem | undefined,
  hasEdited: boolean | undefined,
  // Referenced original outside the package: never request /original, the
  // preview thumb (from the package) stays on screen.
  originalBlocked = false,
  // #221: the filmstrip is being dragged; the full-quality follow-up waits
  // for release (the preview alone is shown while scrubbing).
  deferHeavy = false,
): ViewerMedia {
  const [wantsOriginal, setWantsOriginal] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const [jpegFallback, setJpegFallback] = useState(false);
  const [showingOriginal, setShowingOriginal] = useState(false);

  useEffect(() => {
    setWantsOriginal(false);
    setPreviewLoaded(false);
    setVideoPlaying(false);
    setLivePlaying(false);
    setJpegFallback(false);
    setShowingOriginal(false);
  }, [item?.id]);

  // P1.17b fix round 2: the automatic full-quality fetch must not fire until
  // `hasEdited` is actually known (the asset detail request has resolved),
  // otherwise it requests `version=original` first and `version=edited`
  // moments later once the detail arrives -- a real flash of the unedited
  // photo. Wait for both the preview `onLoad` and a resolved `hasEdited`.
  //
  // #214: and only after the photo has stayed settled for ORIGINAL_DWELL_MS.
  // Paging changes `item.id`, which clears the timer and resets
  // `previewLoaded`, so fast paging never starts a full-size download.
  useEffect(() => {
    if (!previewLoaded || hasEdited === undefined || deferHeavy || isDataSaverOn()) return;
    const timer = window.setTimeout(() => setWantsOriginal(true), ORIGINAL_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [previewLoaded, hasEdited, item?.id, deferHeavy]);

  // Apple Photos always shows the edited render (P1.17b): zoom and video
  // playback ask for `version=edited` whenever the asset has one, same as
  // the grid/preview thumb already does server-side.
  const version: "original" | "edited" = hasEdited ? "edited" : "original";

  return {
    previewSrc: item ? previewThumbUrl(libraryId, item.id) : "",
    originalSrc: item
      ? jpegFallback
        ? originalJpegFallbackUrl(libraryId, item.id, version)
        : originalUrl(libraryId, item.id, version)
      : "",
    liveVideoSrc: item ? livePhotoVideoUrl(libraryId, item.id) : "",
    isVideo: item?.is_video ?? false,
    isLivePhoto: item?.is_live_photo ?? false,
    wantsOriginal: wantsOriginal && !originalBlocked,
    requestOriginal: () => setWantsOriginal(true),
    videoPlaying: videoPlaying && !originalBlocked,
    startVideo: () => setVideoPlaying(true),
    livePlaying,
    startLive: () => setLivePlaying(true),
    stopLive: () => setLivePlaying(false),
    onOriginalError: () => setJpegFallback(true),
    showingOriginal: showingOriginal && !originalBlocked,
    showOriginalSrc: item
      ? jpegFallback
        ? originalJpegFallbackUrl(libraryId, item.id, "original")
        : originalUrl(libraryId, item.id, "original")
      : "",
    startShowOriginal: () => {
      if (hasEdited) setShowingOriginal(true);
    },
    stopShowOriginal: () => setShowingOriginal(false),
    toggleShowOriginal: () => {
      if (hasEdited) setShowingOriginal((value) => !value);
    },
    onPreviewLoaded: () => setPreviewLoaded(true),
  };
}
