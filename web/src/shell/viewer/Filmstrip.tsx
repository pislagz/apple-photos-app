import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { AssetListItem } from "../../api";

const GAP = 2;

// Horizontally virtualized (#114): only the thumbs near the strip's visible
// span are mounted, so it can scroll anywhere in a large library, and the
// current item is kept centered as the Viewer moves through it.
export function Filmstrip({
  libraryId,
  items,
  index,
  onSelect,
  className,
  itemSize,
}: {
  libraryId: number;
  items: AssetListItem[];
  index: number;
  onSelect: (index: number) => void;
  className: string;
  // Thumb edge in px; must match the `${className}__item` width/height in CSS.
  itemSize: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemSize,
    gap: GAP,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [index, virtualizer]);

  return (
    <div ref={scrollRef} className={className} data-testid="viewer-filmstrip">
      <div style={{ position: "relative", width: virtualizer.getTotalSize(), height: itemSize }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          return (
            <button
              key={item.id}
              type="button"
              className={`${className}__item`}
              data-selected={virtualItem.index === index}
              aria-current={virtualItem.index === index}
              style={{ position: "absolute", top: 0, left: 0, transform: `translateX(${virtualItem.start}px)` }}
              onClick={() => onSelect(virtualItem.index)}
            >
              <img src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`} alt="" loading="lazy" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
