import { useEffect, useState } from "react";
import { ApiError, type AssetListItem, getHidden } from "../api";
import { HiddenUnlock } from "./HiddenUnlock";

// Apple Photos' Hidden album (P1.13): the one place a hidden asset is
// listed. This is a minimal list, not the P1.14/P1.15 grid -- it only needs
// to prove the entry point and the `/hidden` route work end to end.
//
// #148: the server re-locks Hidden after 5 idle minutes and answers 403
// `hidden_locked`. That brings the password prompt back in place; a
// successful unlock re-requests the list.
export default function HiddenView({
  libraryId,
  variant,
  onCancel,
}: {
  libraryId: number;
  variant: "mobile" | "desktop";
  onCancel: () => void;
}) {
  const [items, setItems] = useState<AssetListItem[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getHidden(libraryId)
      .then((response) => {
        if (!cancelled) setItems(response.items);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403 && err.code === "hidden_locked") {
          setLocked(true);
        } else {
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, reloadKey]);

  if (locked) {
    return (
      <HiddenUnlock
        variant={variant}
        onUnlocked={() => {
          setLocked(false);
          setItems(null);
          setReloadKey((key) => key + 1);
        }}
        onCancel={onCancel}
      />
    );
  }

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
