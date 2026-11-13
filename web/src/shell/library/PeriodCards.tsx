import { memo, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

// Shared Apple Photos-style period card (#307, reused by the Days cards in
// #301): a rounded, square-ish card with a sharp key photo and the period
// label in the top-left corner over a gradient. Used by Years and Months on
// desktop and iPhone.

export interface PeriodCardData {
  // Bucket key: "2007" or "2007-01".
  key: string;
  label: string;
  count: number;
  keyAssetIds: string[];
}

type ThumbSize = "grid" | "grid2x" | "preview";

// Server thumbnail edges in px (media.SIZES): grid 300, grid2x 600, then preview.
// The smallest one that covers the card at the device pixel ratio, so a
// Retina card never shows an upscaled micro thumbnail (#301).
export function pickThumbSize(cssWidth: number, devicePixelRatio: number): ThumbSize {
  const needed = cssWidth * devicePixelRatio;
  if (needed <= 300) return "grid";
  if (needed <= 600) return "grid2x";
  return "preview";
}

// Days (#301) caption sits bottom-left and shows a count pill instead of a
// count line; the pill only appears when the day has more than 3 photos.
const PILL_MIN_COUNT = 4;

export const PeriodCard = memo(function PeriodCard({
  libraryId,
  card,
  view,
  size,
  onOpen,
}: {
  libraryId: number;
  card: PeriodCardData;
  view: "years" | "months" | "days";
  size: ThumbSize;
  onOpen: (key: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const assetId = card.keyAssetIds[0];
  const countText = `${card.count.toLocaleString("en-US")} ${card.count === 1 ? "Item" : "Items"}`;
  return (
    <button
      type="button"
      className={`period-card period-card--${view}`}
      data-testid="period-card"
      data-period-key={card.key}
      aria-label={`${card.label}, ${countText}`}
      onClick={() => onOpen(card.key)}
    >
      {assetId && (
        <img
          src={`/api/libraries/${libraryId}/thumb/${assetId}?size=${size}`}
          alt={card.label}
          loading="lazy"
          draggable={false}
          className={`period-card__image${loaded ? " is-loaded" : ""}`}
          onLoad={() => setLoaded(true)}
        />
      )}
      <span className="period-card__scrim" aria-hidden="true" />
      <span className="period-card__caption">
        <span className="period-card__label">{card.label}</span>
        {view !== "days" && <span className="period-card__count">{countText}</span>}
      </span>
      {view === "days" && card.count >= PILL_MIN_COUNT && (
        <span className="period-card__pill" data-testid="period-card-pill" aria-hidden="true">
          {card.count.toLocaleString("en-US")}
        </span>
      )}
    </button>
  );
});

// Multi-column card grid, oldest first. It lives inside the caller's scroll
// container (`scrollRef`) and opens scrolled to the newest card at the bottom;
// `landOnKey` instead scrolls to the first card of that year ("2022" ->
// "2022-01") when drilling Years -> Months.
export default function PeriodCardGrid({
  libraryId,
  view,
  cards,
  scrollRef,
  landOnKey,
  onLanded,
  onOpen,
}: {
  libraryId: number;
  view: "years" | "months" | "days";
  cards: PeriodCardData[];
  scrollRef: RefObject<HTMLElement | null>;
  landOnKey?: string | null;
  onLanded?: () => void;
  onOpen: (key: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ThumbSize>("grid2x");
  // Read inside the effect without re-running it when `onLanded` clears it.
  const landOnKeyRef = useRef(landOnKey);
  landOnKeyRef.current = landOnKey;
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || cards.length === 0) return;
    const landOnKey = landOnKeyRef.current;
    const target = landOnKey ? gridRef.current?.querySelector<HTMLElement>(`[data-period-key^="${landOnKey}"]`) : null;
    if (target) {
      target.scrollIntoView?.({ block: "start" });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
    if (landOnKey) onLandedRef.current?.();
    // Once per set of cards, not on every re-render.
  }, [scrollRef, cards]);

  // Re-pick the thumbnail size from the real card width as the container resizes.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const width = grid.querySelector<HTMLElement>(".period-card")?.getBoundingClientRect().width ?? 0;
      if (width > 0) setSize(pickThumbSize(width, window.devicePixelRatio || 1));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [cards]);

  const totalCount = useMemo(() => cards.reduce((sum, card) => sum + card.count, 0), [cards]);

  return (
    <div ref={gridRef} className={`period-grid period-grid--${view}`} data-testid="period-grid">
      {view === "days" && (
        <header className="period-grid__header" data-testid="period-grid-header">
          <h1 className="period-grid__title">Days</h1>
          <p className="period-grid__subtitle">
            {totalCount.toLocaleString("en-US")} {totalCount === 1 ? "Item" : "Items"}
          </p>
        </header>
      )}
      {cards.map((card) => (
        <PeriodCard key={card.key} libraryId={libraryId} card={card} view={view} size={size} onOpen={onOpen} />
      ))}
    </div>
  );
}
