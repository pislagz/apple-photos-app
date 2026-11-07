import { useEffect, useState } from "react";
import { ApiError, type AssetListItem, getHidden } from "../api";
import { HiddenUnlock } from "./HiddenUnlock";

// Apple Photos' Hidden album (P1.13): the one place a hidden asset is
// listed. This is a minimal list, not the P1.14/P1.15 grid -- it only needs
// to prove the entry point and the `/hidden` route work end to end.
//
// #148: the server re-locks Hidden after 5 idle minutes and answers 403
// `hidden_locked`. That brings the password prompt back in place; a
// successful unlock re-requests the list. Any other failure shows an error
// with Retry rather than a misleading "No hidden photos.".
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
  const [failed, setFailed] = useState(false);
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
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, reloadKey]);

  function reload() {
    setLocked(false);
    setFailed(false);
    setItems(null);
    setReloadKey((key) => key + 1);
  }

  if (locked) {
    return <HiddenUnlock variant={variant} onUnlocked={reload} onCancel={onCancel} />;
  }

  if (failed) {
    return (
      <div className="hidden-view hidden-view--error" role="alert">
        <p>Couldn't load hidden photos.</p>
        <button type="button" className="hidden-view__retry" onClick={reload}>
          Retry
        </button>
      </div>
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
