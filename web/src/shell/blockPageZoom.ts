// #409: a trackpad pinch (ctrl+wheel in Chrome/Firefox, gesture events in
// Safari) must not zoom the whole page. The desktop grid (one size stop) and
// the viewer (the photo) handle the pinch themselves from their own element
// listeners (#457, trackpadPinch.ts), which still run: preventDefault here
// stops the browser default, not propagation. The iPhone grid pinch (#213) is
// touch-event based and is not touched by this.
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
