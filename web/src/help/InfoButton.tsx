import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../shell/icons";
import { HELP, type HelpKey } from "./adminHelp";

// The shared (i) button. Desktop: hover or keyboard focus shows the text; touch: a
// tap pins it open. Escape or a tap outside closes it. The text is portalled to
// <body> and positioned from the button, so it is never clipped by a card and does
// not become part of the surrounding <label>'s text.
export default function InfoButton({ helpKey, name, extra, label }: { helpKey: HelpKey; name: string; extra?: string; label?: string }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = hovered || focused || pinned;

  function close() {
    setHovered(false);
    setFocused(false);
    setPinned(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: Event) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !tipRef.current?.contains(target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = tipRef.current?.offsetWidth ?? 280;
    const margin = 8;
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - margin);
    const height = tipRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 6;
    // Flip above the button when the text would run off the bottom of the screen.
    setPos({ top: below + height > window.innerHeight - margin ? Math.max(margin, rect.top - 6 - height) : below, left });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={label ? "info-button info-button--labelled" : "info-button"}
        aria-label={label ? undefined : `About ${name}`}
        aria-describedby={id}
        aria-expanded={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => setPinned((value) => !value)}
      >
        {label && <span>{label}</span>}
        <Icon name="info" size={16} />
      </button>
      {createPortal(
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className="info-tip"
          hidden={!open}
          style={pos ? { top: pos.top, left: pos.left } : undefined}
        >
          {extra ? `${HELP[helpKey]} ${extra}` : HELP[helpKey]}
        </span>,
        document.body,
      )}
    </>
  );
}
