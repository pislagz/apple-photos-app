import { type ImgHTMLAttributes, useCallback, useState } from "react";

// #206: a thumbnail whose placeholder background cross-fades to the picture
// (CSS, `.fade-image`) instead of popping in. A cached image that is already
// complete when it mounts shows at once, so scrolling back never re-fades.
export default function FadeImage({ className, onLoad, onError, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) setLoaded(true);
  }, []);
  return (
    <img
      {...rest}
      ref={ref}
      className={className ? `${className} fade-image` : "fade-image"}
      data-loaded={loaded}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(true);
        onError?.(event);
      }}
    />
  );
}
