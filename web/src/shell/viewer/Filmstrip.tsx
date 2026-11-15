import { assetAlt } from "../assetAlt";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AssetListItem } from "../../api";
import {
  DRAG_THRESHOLD,
  PITCH,
  STRIP_HEIGHT,
  currentWidth,
  dragCell,
  indexAtPos,
  posFromDrag,
  restCell,
  videoFraction,
  visibleRange,
} from "./filmstripGeometry";

// Centred scrubber (#221, was the windowed ±25 strip of #114). The strip is
// not natively scrollable: cells are placed by pure geometry
// (filmstripGeometry.ts) relative to the strip's centre, only a window of the
// full list is mounted, and dragging maps pointer travel to a fractional
// index so any position in a library of tens of thousands is reachable.
export function Filmstrip({
  libraryId,
  items,
  index,
  onSelect,
  className,
  onScrubbingChange,
  onVideoScrub,
}: {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onSelect: (index: number) => void;
  className: string;
  // True from the first live change of a drag until release, so the Viewer
  // can hold back original / heavy loads.
  onScrubbingChange?: (scrubbing: boolean) => void;
  // Dragging inside the expanded video cell: fraction 0..1 of its length.
  onVideoScrub?: (fraction: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const [dragPos, setDragPos] = useState<number | null>(null);
  const press = useRef<{
    id: number;
    x: number;
    startPos: number;
    mode: "pending" | "list" | "video";
    cellLeft: number;
    cellWidth: number;
  } | null>(null);
  const frame = useRef(0);
  const pendingPos = useRef(0);
  const lastEmitted = useRef(index);
  const wheelAcc = useRef(0);
  const suppressClick = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;
  const count = items.length;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setStripWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const dragging = dragPos !== null;
  const layoutPos = dragPos ?? index;
  const [lo, hi] = visibleRange(layoutPos, count, stripWidth);
  const current = items[index];
  const curW = currentWidth(current, stripWidth);

  const endPress = useCallback(
    (el: HTMLElement | null, pointerId: number) => {
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      const state = press.current;
      press.current = null;
      if (el?.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
      if (state && state.mode !== "pending") {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        // Finish on the item nearest the centre line, even if the last frame
        // had not been flushed yet.
        if (state.mode === "list") {
          const finalIndex = indexAtPos(pendingPos.current, count);
          if (finalIndex !== lastEmitted.current) {
            lastEmitted.current = finalIndex;
            onSelect(finalIndex);
          }
        }
        setDragPos(null);
        onScrubbingChange?.(false);
      }
    },
    [count, onScrubbingChange, onSelect],
  );

  const startList = (startX: number, x: number, startPos: number, el: HTMLElement) => {
    const state = press.current!;
    state.mode = "list";
    state.x = startX;
    state.startPos = startPos;
    pendingPos.current = posFromDrag(startPos, x - startX, count);
    lastEmitted.current = indexRef.current;
    el.setPointerCapture?.(state.id);
    setDragPos(pendingPos.current);
    onScrubbingChange?.(true);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || count === 0) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const centreX = (rect?.left ?? 0) + (rect?.width ?? 0) / 2;
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      startPos: index,
      mode: "pending",
      cellLeft: centreX - curW / 2,
      cellWidth: curW,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = press.current;
    if (!state || event.pointerId !== state.id) return;
    const el = event.currentTarget;
    const dx = event.clientX - state.x;
    if (state.mode === "pending") {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      const inVideoCell =
        current?.is_video === true &&
        !!onVideoScrub &&
        state.x >= state.cellLeft &&
        state.x <= state.cellLeft + state.cellWidth;
      if (inVideoCell) {
        state.mode = "video";
        el.setPointerCapture?.(state.id);
        onScrubbingChange?.(true);
      } else {
        startList(state.x, event.clientX, state.startPos, el);
      }
    }
    if (state.mode === "video") {
      const outside = event.clientX < state.cellLeft || event.clientX > state.cellLeft + state.cellWidth;
      if (!outside) {
        onVideoScrub?.(videoFraction(event.clientX - state.cellLeft, state.cellWidth));
        return;
      }
      // Past the cell's edge the same drag carries on into the photo list.
      const edge = event.clientX < state.cellLeft ? state.cellLeft : state.cellLeft + state.cellWidth;
      startList(edge, event.clientX, indexRef.current, el);
    }
    pendingPos.current = posFromDrag(state.startPos, event.clientX - state.x, count);
    if (frame.current) return;
    // Throttled to animation frames; the Viewer swaps to the preview only.
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setDragPos(pendingPos.current);
      const next = indexAtPos(pendingPos.current, count);
      if (next !== lastEmitted.current) {
        lastEmitted.current = next;
        onSelect(next);
      }
    });
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    wheelAcc.current += delta;
    const steps = Math.trunc(wheelAcc.current / PITCH);
    if (steps === 0) return;
    wheelAcc.current -= steps * PITCH;
    const next = indexAtPos(index + steps, count);
    if (next !== index) onSelect(next);
  };

  const cells = [];
  for (let i = lo; i <= hi; i++) {
    const item = items[i];
    const cell = dragging ? dragCell(i, layoutPos) : restCell(i, index, curW);
    const isCurrent = i === index;
    const expanded = isCurrent && !dragging;
    const url = `/api/libraries/${libraryId}/thumb/${item.id}?size=grid`;
    cells.push(
      <button
        key={item.id}
        type="button"
        className={`${className}__item`}
        data-selected={isCurrent}
        data-expanded={expanded}
        data-video={item.is_video || undefined}
        data-index={i}
        aria-current={isCurrent}
        aria-label={assetAlt(item)}
        style={{ width: cell.width, transform: `translateX(${cell.left}px)` }}
        onClick={() => {
          if (!suppressClick.current) onSelect(i);
        }}
      >
        {expanded && item.is_video ? (
          <span className={`${className}__frames`} style={{ backgroundImage: `url("${url}")` }} />
        ) : (
          <img src={url} alt="" loading="lazy" draggable={false} />
        )}
      </button>,
    );
  }

  return (
    <div
      ref={rootRef}
      className={className}
      data-testid="viewer-filmstrip"
      data-dragging={dragging}
      style={{ height: STRIP_HEIGHT }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => endPress(e.currentTarget, e.pointerId)}
      onWheel={onWheel}
    >
      <div className={`${className}__track`}>{cells}</div>
      {current?.is_video && !dragging && <span className={`${className}__playhead`} data-testid="filmstrip-playhead" aria-hidden />}
    </div>
  );
}
