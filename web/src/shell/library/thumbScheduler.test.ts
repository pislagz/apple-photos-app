import { describe, expect, it, vi } from "vitest";
import { FAST_SCROLL_PX_PER_S, ThumbScheduler, watchScrollSpeed } from "./thumbScheduler";

function task(top?: number) {
  const t = { done: undefined as undefined | (() => void), ran: 0, aborted: 0 };
  return {
    t,
    task: {
      run: (done: () => void) => {
        t.ran += 1;
        t.done = done;
      },
      abort: () => {
        t.aborted += 1;
      },
      top: top === undefined ? undefined : () => top,
    },
  };
}

describe("ThumbScheduler", () => {
  it("never runs more than the cap and starts waiting tasks as slots free", () => {
    const s = new ThumbScheduler(2);
    const all = [task(), task(), task(), task()];
    all.forEach((a) => s.enqueue(a.task));
    expect(s.running).toBe(2);
    expect(s.waiting).toBe(2);
    all[1].t.done?.();
    expect(s.running).toBe(2);
    expect(s.waiting).toBe(1);
  });

  it("starts the newest queued task first", () => {
    const s = new ThumbScheduler(1);
    const first = task();
    const old = task();
    const fresh = task();
    s.enqueue(first.task);
    s.enqueue(old.task);
    s.enqueue(fresh.task);
    first.t.done?.();
    expect(fresh.t.ran).toBe(1);
    expect(old.t.ran).toBe(0);
  });

  it("cancel drops a queued task and aborts a running one, freeing the slot", () => {
    const s = new ThumbScheduler(1);
    const a = task();
    const b = task();
    const ha = s.enqueue(a.task);
    const hb = s.enqueue(b.task);
    hb.cancel();
    expect(s.waiting).toBe(0);
    expect(b.t.ran).toBe(0);
    ha.cancel();
    expect(a.t.aborted).toBe(1);
    expect(s.running).toBe(0);
  });

  it("starts nothing while paused, then resumes", () => {
    const s = new ThumbScheduler(8);
    s.setPaused(true);
    const a = task();
    s.enqueue(a.task);
    expect(a.t.ran).toBe(0);
    s.setPaused(false);
    expect(a.t.ran).toBe(1);
  });

  it("loads tasks in the landing band before newer ones outside it", () => {
    const s = new ThumbScheduler(1);
    s.setPaused(true);
    const inBand = task(500);
    const outside = task(5000);
    s.enqueue(inBand.task);
    s.enqueue(outside.task);
    s.setBand([0, 1000]);
    s.setPaused(false);
    expect(inBand.t.ran).toBe(1);
    expect(outside.t.ran).toBe(0);
  });
});

describe("watchScrollSpeed", () => {
  it("pauses above the fast threshold and resumes after the scroll settles", () => {
    vi.useFakeTimers();
    const s = new ThumbScheduler(8);
    let clock = 0;
    const stop = watchScrollSpeed(s, () => clock, () => 800, 100);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const scrollTo = (top: number, at: number) => {
      clock = at;
      el.scrollTop = top;
      el.dispatchEvent(new Event("scroll"));
    };
    scrollTo(0, 0);
    scrollTo(10, 10);
    const pxPerSecond = (FAST_SCROLL_PX_PER_S + 1000) / 100; // per 10 ms step
    scrollTo(10 + pxPerSecond, 20);
    const a = task();
    s.enqueue(a.task);
    expect(a.t.ran).toBe(0);
    vi.advanceTimersByTime(150);
    expect(a.t.ran).toBe(1);
    stop();
    el.remove();
    vi.useRealTimers();
  });
});
