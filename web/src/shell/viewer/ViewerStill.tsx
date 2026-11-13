import { type CSSProperties, type HTMLAttributes, useState } from "react";
import { ORIGINAL_FADE_MS } from "./gestures";

interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, "onError" | "onLoad"> {
  imgClassName: string;
  stillSrc: string;
  previewSrc: string;
  // #286: shown behind the preview until it has loaded (the grid's thumbnail),
  // so the open zoom never grows an empty frame.
  placeholderSrc?: string;
  alt: string;
  // True when `stillSrc` is a full-resolution file rather than the preview.
  isFull: boolean;
  onLoad: () => void;
  onError?: () => void;
  transform: CSSProperties;
}

// The viewer's still. While a full-resolution file loads, the preview stays
// underneath and the file fades in over it (#214), so the swap is not a flash.
// The first <img> is always the one showing `stillSrc`.
export function ViewerStill({ imgClassName, stillSrc, previewSrc, placeholderSrc, alt, isFull, onLoad, onError, transform, ...rest }: Props) {
  const [loadedSrc, setLoadedSrc] = useState("");
  const fading = isFull && loadedSrc !== stillSrc;
  return (
    <span
      className="viewer-still"
      style={placeholderSrc ? { ...transform, backgroundImage: `url("${placeholderSrc}")` } : transform}
      {...rest}
    >
      <img
        className={`${imgClassName} viewer-still__main`}
        src={stillSrc}
        alt={alt}
        draggable={false}
        style={isFull ? { opacity: fading ? 0 : 1, transition: `opacity ${ORIGINAL_FADE_MS}ms ease-out` } : undefined}
        onLoad={() => {
          setLoadedSrc(stillSrc);
          onLoad();
        }}
        onError={onError}
      />
      {isFull && <img className={`${imgClassName} viewer-still__under`} src={previewSrc} alt="" aria-hidden draggable={false} />}
    </span>
  );
}
