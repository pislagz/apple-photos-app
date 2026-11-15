import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icons";

// #434: the +/- zoom slider shared by the desktop grid toolbar and the photo
// viewer toolbar. Callers own the value; this only draws it.
export default function ZoomSlider({
  min,
  max,
  step,
  value,
  onChange,
  onStep,
  testId,
  children,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  onStep: (direction: -1 | 1) => void;
  testId?: string;
  children?: ReactNode;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="desktop-library__zoom-slider">
      <button
        type="button"
        className="toolbar-button toolbar-button--small desktop-library__zoom-end"
        aria-label="Zoom Out"
        title="Zoom Out"
        disabled={value <= min}
        onClick={() => onStep(-1)}
      >
        <Icon name="minus" size={14} />
      </button>
      <input
        type="range"
        aria-label="Zoom"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-fill": `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        data-testid={testId}
      />
      <button
        type="button"
        className="toolbar-button toolbar-button--small desktop-library__zoom-end"
        aria-label="Zoom In"
        title="Zoom In"
        disabled={value >= max}
        onClick={() => onStep(1)}
      >
        <Icon name="plus" size={14} />
      </button>
      {children}
    </div>
  );
}
