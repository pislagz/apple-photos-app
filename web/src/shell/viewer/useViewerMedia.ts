import { useEffect, useState } from "react";
import type { AssetListItem } from "../../api";
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
}

export function useViewerMedia(libraryId: number, item: AssetListItem | undefined, hasEdited: boolean): ViewerMedia {
  const [wantsOriginal, setWantsOriginal] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const [jpegFallback, setJpegFallback] = useState(false);

  useEffect(() => {
    setWantsOriginal(false);
    setVideoPlaying(false);
    setLivePlaying(false);
    setJpegFallback(false);
  }, [item?.id]);

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
    wantsOriginal,
    requestOriginal: () => setWantsOriginal(true),
    videoPlaying,
    startVideo: () => setVideoPlaying(true),
    livePlaying,
    startLive: () => setLivePlaying(true),
    stopLive: () => setLivePlaying(false),
    onOriginalError: () => setJpegFallback(true),
  };
}
