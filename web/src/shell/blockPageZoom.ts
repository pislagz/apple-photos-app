// #409: a trackpad pinch (ctrl+wheel in Chrome/Firefox, gesture events in
// Safari) must not zoom the whole page. Only a photo or video in the viewer
// zooms, and it does so itself from its own wheel listener, which still runs:
// preventDefault here stops the browser default, not propagation. The iPhone
// grid pinch (#213) is touch-event based and is not touched by this.
export function installBlockPageZoom(target: Window = window): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };
  const onGesture = (event: Event) => event.preventDefault();
  const gestures = ["gesturestart", "gesturechange", "gestureend"];
  // Non-passive, or preventDefault is ignored for wheel.
  target.addEventListener("wheel", onWheel, { passive: false, capture: true });
  for (const type of gestures) target.addEventListener(type, onGesture, { passive: false });
  return () => {
    target.removeEventListener("wheel", onWheel, { capture: true });
    for (const type of gestures) target.removeEventListener(type, onGesture);
  };
}
