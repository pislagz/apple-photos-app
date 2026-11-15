import { useCallback, useEffect, useRef, useState } from "react";

// #211. Local motion constants, to be switched to the #206 motion tokens
// once that lands (CSS uses the same 200 ms in shell.css, `.is-chrome-hidden`).
export const CHROME_FADE_MS = 200;
// Video playback hides the bars after this long without a tap / pointer move.
export const CHROME_AUTOHIDE_MS = 2500;

// Whether the viewer bars are hidden. `toggle` is the iPhone single tap;
// `reveal` is a pointer move on desktop. While a video plays (`autoHide`)
// every reveal re-arms a 2.5 s timer; when playback stops the bars return.
export function useChromeVisibility(autoHide: boolean) {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const timer = useRef<number | null>(null);

  const set = useCallback((value: boolean) => {
    hiddenRef.current = value;
    setHidden(value);
  }, []);
  const disarm = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const arm = useCallback(() => {
    disarm();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      set(true);
    }, CHROME_AUTOHIDE_MS);
  }, [disarm, set]);

  useEffect(() => {
    if (autoHide) {
      arm();
    } else {
      disarm();
      set(false);
    }
    return disarm;
  }, [autoHide, arm, disarm, set]);

  const reveal = useCallback(() => {
    set(false);
    if (autoHide) arm();
  }, [autoHide, arm, set]);

  const toggle = useCallback(() => {
    if (hiddenRef.current) {
      reveal();
    } else {
      disarm();
      set(true);
    }
  }, [reveal, disarm, set]);

  return { hidden, toggle, reveal };
}
