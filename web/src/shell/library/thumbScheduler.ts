// #215: one place that decides which grid thumbnails may start loading.
//   - at most `maxInFlight` requests run at once;
//   - while the grid is scrolling fast nothing new starts (`setPaused`);
//   - after that the tiles in the landing band start first (`setBand`),
//     then the rest; inside a group the newest request goes first, so the
//     rows the user is looking at win over rows they have scrolled past;
//   - a request that is cancelled before it starts never runs, and one that
//     is cancelled while running frees its slot at once.

export const MAX_THUMB_IN_FLIGHT = 8;
// Above this the grid is flying past; below it we load again.
export const FAST_SCROLL_PX_PER_S = 3000;

export interface ThumbTask {
  // Starts the load. Must call `done` once when it has finished or failed.
  run: (done: () => void) => void;
  // Called when the task is cancelled while running (abort the request).
  abort: () => void;
  // Viewport-relative top of the tile, read at pick time; used for the band.
  top?: () => number;
}

export interface ThumbHandle {
  cancel: () => void;
}

interface Entry {
  task: ThumbTask;
  seq: number;
  running: boolean;
  finished: boolean;
}

export class ThumbScheduler {
  private queue: Entry[] = [];
  private inFlight = 0;
  private seq = 0;
  private paused = false;
  private band: [number, number] | null = null;

  constructor(private readonly maxInFlight = MAX_THUMB_IN_FLIGHT) {}

  get running(): number {
    return this.inFlight;
  }

  get waiting(): number {
    return this.queue.length;
  }

  enqueue(task: ThumbTask): ThumbHandle {
    const entry: Entry = { task, seq: this.seq++, running: false, finished: false };
    this.queue.push(entry);
    this.pump();
    return { cancel: () => this.cancel(entry) };
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.pump();
  }

  // Viewport-relative [from, to] range loaded before everything else; null clears it.
  setBand(band: [number, number] | null): void {
    this.band = band;
    this.pump();
  }

  private cancel(entry: Entry): void {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.running) {
      this.inFlight -= 1;
      entry.task.abort();
    } else {
      this.queue = this.queue.filter((queued) => queued !== entry);
    }
    this.pump();
  }

  private inBand(entry: Entry): boolean {
    if (!this.band || !entry.task.top) return false;
    const top = entry.task.top();
    return top >= this.band[0] && top <= this.band[1];
  }

  private next(): Entry | undefined {
    let best: Entry | undefined;
    let bestInBand = false;
    for (const entry of this.queue) {
      const inBand = this.inBand(entry);
      if (!best || (inBand && !bestInBand) || (inBand === bestInBand && entry.seq > best.seq)) {
        best = entry;
        bestInBand = inBand;
      }
    }
    return best;
  }

  private pump(): void {
    while (!this.paused && this.inFlight < this.maxInFlight) {
      const entry = this.next();
      if (!entry) return;
      this.queue = this.queue.filter((queued) => queued !== entry);
      entry.running = true;
      this.inFlight += 1;
      entry.task.run(() => {
        if (entry.finished) return;
        entry.finished = true;
        this.inFlight -= 1;
        this.pump();
      });
    }
  }
}

export const thumbScheduler = new ThumbScheduler();

// Watches scrolling anywhere in the page (scroll events do not bubble, so
// listen in the capture phase) and drives the scheduler: pause above
// FAST_SCROLL_PX_PER_S, and on slowing or stopping, open the landing band.
export function watchScrollSpeed(
  scheduler: ThumbScheduler,
  now: () => number = () => performance.now(),
  viewportHeight: () => number = () => window.innerHeight,
  settleMs = 120,
): () => void {
  let lastTop = 0;
  let lastAt = 0;
  let lastTarget: EventTarget | null = null;
  let timer: number | undefined;

  const settle = (velocity: number) => {
    const vh = viewportHeight();
    // 1.5 viewports centred on where the scroll will land.
    const centre = vh / 2 + Math.max(-vh, Math.min(vh, velocity * 0.2));
    scheduler.setBand([centre - vh * 0.75, centre + vh * 0.75]);
    scheduler.setPaused(false);
  };

  const onScroll = (event: Event) => {
    const target = event.target as { scrollTop?: number } | null;
    const top = target && typeof target.scrollTop === "number" ? target.scrollTop : window.scrollY;
    const at = now();
    if (event.target === lastTarget && at > lastAt) {
      const velocity = ((top - lastTop) / (at - lastAt)) * 1000;
      if (Math.abs(velocity) > FAST_SCROLL_PX_PER_S) {
        scheduler.setPaused(true);
      } else if (scheduler.waiting > 0) {
        settle(velocity);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => settle(0), settleMs);
    }
    lastTarget = event.target;
    lastTop = top;
    lastAt = at;
  };

  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    window.clearTimeout(timer);
    scheduler.setPaused(false);
    scheduler.setBand(null);
  };
}
