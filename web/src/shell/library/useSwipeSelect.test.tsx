import { act, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSwipeSelect } from "./useSwipeSelect";

const ORDER = ["a", "b", "c", "d"];
let selected = new Set<string>();

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  selected = sel;
  useSwipeSelect(true, ref, ORDER, sel, setSel);
  return (
    <div ref={ref} data-testid="scroll">
      {ORDER.map((id) => (
        <button key={id} type="button" data-asset-id={id} data-testid={id} />
      ))}
    </div>
  );
}

function ptr(type: string, target: EventTarget, init: PointerEventInit) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(ev, { pointerId: 1, pointerType: init.pointerType ?? "mouse", isPrimary: true });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function mockHit(map: Record<number, string>) {
  document.elementFromPoint = ((x: number) => document.querySelector(`[data-asset-id="${map[x]}"]`)) as never;
}

afterEach(() => {
  selected = new Set();
});

describe("useSwipeSelect with a mouse (#504)", () => {
  it("selects the dragged range and swallows the trailing click", () => {
    const { getByTestId } = render(<Harness />);
    mockHit({ 10: "a", 40: "b", 70: "c" });
    ptr("pointerdown", getByTestId("a"), { clientX: 10, clientY: 5, button: 0, buttons: 1 });
    ptr("pointermove", window, { clientX: 40, clientY: 5, buttons: 1 });
    ptr("pointermove", window, { clientX: 70, clientY: 5, buttons: 1 });
    expect([...selected]).toEqual(["a", "b", "c"]);
    ptr("pointerup", window, { clientX: 70, clientY: 5 });
    const onClick = vi.fn();
    getByTestId("c").addEventListener("click", onClick);
    act(() => getByTestId("c").click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not select on a plain click, and allows vertical mouse drags", () => {
    const { getByTestId } = render(<Harness />);
    mockHit({ 10: "a", 12: "b" });
    ptr("pointerdown", getByTestId("a"), { clientX: 10, clientY: 5, button: 0, buttons: 1 });
    ptr("pointerup", window, { clientX: 10, clientY: 5 });
    expect(selected.size).toBe(0);
    const onClick = vi.fn();
    getByTestId("a").addEventListener("click", onClick);
    act(() => getByTestId("a").click());
    expect(onClick).toHaveBeenCalled();
    ptr("pointerdown", getByTestId("a"), { clientX: 10, clientY: 5, button: 0, buttons: 1 });
    ptr("pointermove", window, { clientX: 12, clientY: 50, buttons: 1 });
    expect([...selected]).toEqual(["a", "b"]);
  });
});
