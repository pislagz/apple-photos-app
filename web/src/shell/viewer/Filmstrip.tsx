import type { AssetListItem } from "../../api";

// Windowed, not virtualized: the Viewer only ever needs a strip around the
// current item on screen, so a fixed window is simpler than wiring up
// TanStack Virtual a second time for a row this short.
const WINDOW_RADIUS = 25;

export function Filmstrip({
  libraryId,
  items,
  index,
  onSelect,
  className,
}: {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onSelect: (index: number) => void;
  className: string;
}) {
  const start = Math.max(0, index - WINDOW_RADIUS);
  const end = Math.min(items.length, index + WINDOW_RADIUS + 1);

  return (
    <div className={className} data-testid="viewer-filmstrip">
      {items.slice(start, end).map((item, offset) => {
        const itemIndex = start + offset;
        return (
          <button
            key={item.id}
            type="button"
            className={`${className}__item`}
            data-selected={itemIndex === index}
            aria-current={itemIndex === index}
            onClick={() => onSelect(itemIndex)}
          >
            <img src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`} alt="" loading="lazy" />
          </button>
        );
      })}
    </div>
  );
}
