import { useEffect, useState } from "react";
import { type AssetListItem, getHidden } from "../api";

// Apple Photos' Hidden album (P1.13): the one place a hidden asset is
// listed. This is a minimal list, not the P1.14/P1.15 grid -- it only needs
// to prove the entry point and the `/hidden` route work end to end.
export default function HiddenView({ libraryId }: { libraryId: number }) {
  const [items, setItems] = useState<AssetListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHidden(libraryId)
      .then((response) => {
        if (!cancelled) setItems(response.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="hidden-view">
        <p>No hidden photos.</p>
      </div>
    );
  }

  return (
    <ul className="hidden-view">
      {items.map((item) => (
        <li key={item.id}>{item.filename ?? item.id}</li>
      ))}
    </ul>
  );
}
