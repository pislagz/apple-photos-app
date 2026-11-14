import { formatMonthHeader } from "./rows";
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

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
  // Days only: the iPhone card title ("Saturday").
  weekday?: string;
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
  phone = false,
  onOpen,
}: {
  libraryId: number;
  card: PeriodCardData;
  view: "years" | "months" | "days";
  size: ThumbSize;
  // iPhone (#219): bold title + subtitle, and a two-photo column on Days.
  phone?: boolean;
  onOpen: (key: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const assetId = card.keyAssetIds[0];
  const countText = `${card.count.toLocaleString("en-US")} ${card.count === 1 ? "Item" : "Items"}`;
  // The key photo spans the card unless the day has 3+ photos to show.
  const mosaic = phone && view === "days" && card.count >= 3 ? card.keyAssetIds.slice(1, 3) : [];
  const hasMosaic = mosaic.length === 2;
  return (
    <button
      type="button"
      className={`period-card period-card--${view}${phone ? " period-card--phone" : ""}${hasMosaic ? " period-card--mosaic" : ""}`}
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
      {hasMosaic && (
        <span className="period-card__mosaic" aria-hidden="true">
          {mosaic.map((id) => (
            <img
              key={id}
              src={`/api/libraries/${libraryId}/thumb/${id}?size=grid2x`}
              alt=""
              loading="lazy"
              draggable={false}
              className="period-card__mosaic-image"
            />
          ))}
        </span>
      )}
      <span className="period-card__scrim" aria-hidden="true" />
      <span className="period-card__caption">
        {phone && view === "days" ? (
          <>
            <span className="period-card__label">{card.weekday ?? card.label}</span>
            <span className="period-card__count">{`${card.label} · ${countText}`}</span>
          </>
        ) : (
          <>
            <span className="period-card__label">{card.label}</span>
            {view !== "days" && !(phone && view === "years") && <span className="period-card__count">{countText}</span>}
          </>
        )}
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
  phone = false,
  onOpen,
}: {
  libraryId: number;
  view: "years" | "months" | "days";
  // iPhone cards (#219): one column; Months lists Day cards under month headers.
  phone?: boolean;
  cards: PeriodCardData[];
  scrollRef: RefObject<HTMLElement | null>;
  landOnKey?: string | null;
  onLanded?: () => void;
  onOpen: (key: string) => void;
}) {
  const cardView = phone && view === "months" ? "days" : view;
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
    <div ref={gridRef} className={`period-grid period-grid--${view}${phone ? " period-grid--phone" : ""}`} data-testid="period-grid">
      {view === "days" && (
        <header className="period-grid__header" data-testid="period-grid-header">
          <h1 className="period-grid__title">Days</h1>
          <p className="period-grid__subtitle">
            {totalCount.toLocaleString("en-US")} {totalCount === 1 ? "Item" : "Items"}
          </p>
        </header>
      )}
      {cards.map((card, index) => (
        <Fragment key={card.key}>
          {phone && view === "months" && card.key.slice(0, 7) !== cards[index - 1]?.key.slice(0, 7) && (
            <h2 className="period-grid__month" data-testid="period-month-header">
              {formatMonthHeader(card.key)}
            </h2>
          )}
          <PeriodCard libraryId={libraryId} card={card} view={cardView} size={size} phone={phone} onOpen={onOpen} />
        </Fragment>
      ))}
    </div>
  );
}
