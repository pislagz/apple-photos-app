import { type ImgHTMLAttributes, useCallback, useEffect, useRef, useState } from "react";
import { thumbScheduler } from "./thumbScheduler";

// #206 / #215: a grid thumbnail. Its placeholder tile cross-fades to the
// picture (CSS, `.fade-image`) instead of popping in. The `src` is only set
// while the tile is within one viewport of the scroller, and only when the
// shared scheduler (8 requests at a time, nothing during a fast flick) lets
// it. A tile that leaves that margin before its picture arrived is aborted.

// URLs that have already loaded: a tile that remounts for one of them shows
// at once and does not fade again, and does not queue behind other loads.
const loadedUrls = new Set<string>();
const LOADED_URLS_MAX = 4000;

// Without IntersectionObserver (old engines, jsdom) there is nothing to
// schedule against, so the picture just loads like a plain <img>.
const canObserve = () => typeof IntersectionObserver !== "undefined";

export function rememberLoaded(url: string): void {
  if (loadedUrls.size >= LOADED_URLS_MAX) loadedUrls.clear();
  loadedUrls.add(url);
}

export function forgetLoadedForTests(): void {
  loadedUrls.clear();
}

function scrollParent(element: HTMLElement): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

export default function FadeImage({
  className,
  onLoad,
  onError,
  src,
  loading: _loading,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(() => (src ? loadedUrls.has(src) : false));
  const [shown, setShown] = useState<string | undefined>(() => (src && (loadedUrls.has(src) || !canObserve()) ? src : undefined));
  const [near, setNear] = useState(!canObserve());
  const element = useRef<HTMLImageElement | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const doneRef = useRef<(() => void) | null>(null);

  const ref = useCallback((img: HTMLImageElement | null) => {
    element.current = img;
  }, []);

  useEffect(() => {
    const img = element.current;
    if (!img || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), {
      root: scrollParent(img),
      rootMargin: "100% 0px",
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !src || !canObserve()) return;
    if (loadedUrls.has(src)) {
      setShown(src);
      setLoaded(true);
      return;
    }
    const handle = thumbScheduler.enqueue({
      run: (done) => {
        doneRef.current = done;
        setShown(src);
      },
      // Dropping `src` makes the browser cancel the request.
      abort: () => {
        doneRef.current = null;
        if (!loadedRef.current) setShown(undefined);
      },
      top: () => element.current?.getBoundingClientRect().top ?? 0,
    });
    return () => handle.cancel();
  }, [near, src]);

  const finish = () => {
    setLoaded(true);
    const done = doneRef.current;
    doneRef.current = null;
    done?.();
  };

  return (
    <img
      draggable={false}
      {...rest}
      src={canObserve() ? shown : src}
      ref={ref}
      className={className ? `${className} fade-image` : "fade-image"}
      data-loaded={loaded}
      onLoad={(event) => {
        if (shown) rememberLoaded(shown);
        finish();
        onLoad?.(event);
      }}
      onError={(event) => {
        finish();
        onError?.(event);
      }}
    />
  );
}
