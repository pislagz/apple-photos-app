import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";

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

// Cards are at most ~300 px wide on a 2x display, so `grid2x` (600 px) is
// sharp at the card size; the 300 px `grid` size would be an upscaled blur.
const CARD_THUMB_SIZE = "grid2x";

export const PeriodCard = memo(function PeriodCard({
  libraryId,
  card,
  onOpen,
}: {
  libraryId: number;
  card: PeriodCardData;
  onOpen: (key: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const assetId = card.keyAssetIds[0];
  const countText = `${card.count.toLocaleString("en-US")} ${card.count === 1 ? "Item" : "Items"}`;
  return (
    <button
      type="button"
      className="period-card"
      data-testid="period-card"
      data-period-key={card.key}
      aria-label={`${card.label}, ${countText}`}
      onClick={() => onOpen(card.key)}
    >
      {assetId && (
        <img
          src={`/api/libraries/${libraryId}/thumb/${assetId}?size=${CARD_THUMB_SIZE}`}
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
        <span className="period-card__count">{countText}</span>
      </span>
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
  view: "years" | "months";
  cards: PeriodCardData[];
  scrollRef: RefObject<HTMLElement | null>;
  landOnKey?: string | null;
  onLanded?: () => void;
  onOpen: (key: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div ref={gridRef} className={`period-grid period-grid--${view}`} data-testid="period-grid">
      {cards.map((card) => (
        <PeriodCard key={card.key} libraryId={libraryId} card={card} onOpen={onOpen} />
      ))}
    </div>
  );
}
