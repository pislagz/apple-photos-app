import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, type AssetListItem, type LibrarySummary, getAssets, setAvatar } from "../api";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  type Point,
  clampOffset,
  clampZoom,
  cropFractions,
  displaySize,
} from "./avatarCrop";

const DIAMETER = 240;
const NUDGE = 12;
const PAGE = 60;

// #256: choose a photo, then frame it in a circle. Step 1 is a grid of the
// user's own photos; step 2 is the crop. Written for people who don't know
// what "crop" or "asset" mean, so the labels are plain.
export default function AvatarPicker({
  libraries,
  initialLibraryId,
  onClose,
  onSaved,
}: {
  libraries: LibrarySummary[];
  initialLibraryId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [libraryId, setLibraryId] = useState<number | undefined>(
    initialLibraryId !== undefined && libraries.some((l) => l.id === initialLibraryId)
      ? initialLibraryId
      : libraries[0]?.id,
  );
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [chosen, setChosen] = useState<AssetListItem | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ zoom: number; distance: number } | null>(null);
  const loadId = useRef(0);

  const load = (id: number, from: string | null) => {
    const mine = ++loadId.current;
    setLoading(true);
    setLoadError(false);
    getAssets(id, from, PAGE, null, "photos")
      .then((page) => {
        if (mine !== loadId.current) return;
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.next_cursor);
      })
      .catch(() => mine === loadId.current && setLoadError(true))
      .finally(() => mine === loadId.current && setLoading(false));
  };

  useEffect(() => {
    setItems([]);
    setCursor(null);
    if (libraryId !== undefined) load(libraryId, null);
  }, [libraryId]);

  const busyRef = useRef(false);
  busyRef.current = saving;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("select, button, [tabindex='0']")?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  const size = natural ? displaySize(natural, DIAMETER, zoom) : null;

  const applyZoom = (next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    if (natural) setOffset((o) => clampOffset(o, displaySize(natural, DIAMETER, z), DIAMETER));
  };
  const move = (dx: number, dy: number) => {
    if (size) setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, size, DIAMETER));
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) gesture.current = { zoom, distance: distance() || 1 };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && gesture.current) {
      applyZoom(gesture.current.zoom * (distance() / gesture.current.distance));
    } else {
      move(point.x - last.x, point.y - last.y);
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
  };
  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [NUDGE, 0],
      ArrowRight: [-NUDGE, 0],
      ArrowUp: [0, NUDGE],
      ArrowDown: [0, -NUDGE],
    };
    if (step[event.key]) {
      event.preventDefault();
      move(...step[event.key]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      applyZoom(zoom + 0.1);
    } else if (event.key === "-") {
      event.preventDefault();
      applyZoom(zoom - 0.1);
    }
  };

  const choose = (item: AssetListItem) => {
    setChosen(item);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setSaveError(null);
  };

  const save = async () => {
    if (!chosen || !size || libraryId === undefined || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setAvatar(libraryId, chosen.id, cropFractions(size, offset, DIAMETER));
      onSaved();
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof ApiError && error.status === 404
          ? "That photo isn’t available any more. Go back and pick another."
          : "Couldn’t save your picture. Try again.",
      );
      setSaving(false);
    }
  };

  const transform = size
    ? { width: size.w, height: size.h, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }
    : undefined;

  return createPortal(
    <div
      className="avatar-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
      ref={dialogRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="avatar-picker__card">
        {chosen === null ? (
          <>
            <h2 id="avatar-picker-title">Choose a photo</h2>
            {libraries.length > 1 && (
              <label className="avatar-picker__library">
                Photo library
                <select value={libraryId} onChange={(event) => setLibraryId(Number(event.target.value))}>
                  {libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="avatar-picker__grid" role="list">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className="avatar-picker__thumb"
                  aria-label={`Use ${item.original_filename ?? item.filename ?? "this photo"}`}
                  onClick={() => choose(item)}
                >
                  <img src={`/api/libraries/${libraryId}/thumb/${item.id}?size=grid`} alt="" loading="lazy" />
                </button>
              ))}
            </div>
            {loadError && (
              <p role="alert" className="avatar-picker__error">
                Couldn’t load your photos.
              </p>
            )}
            {!loading && !loadError && items.length === 0 && <p>There are no photos to choose from.</p>}
            <div className="avatar-picker__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              {cursor && (
                <button type="button" disabled={loading} onClick={() => libraryId !== undefined && load(libraryId, cursor)}>
                  Show more photos
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 id="avatar-picker-title">Position your picture</h2>
            <div
              className="avatar-picker__stage"
              role="group"
              tabIndex={0}
              aria-label="Your picture. Drag the photo to move it. Pinch, or use the slider, to zoom. With a keyboard, use the arrow keys to move and plus and minus to zoom."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onStageKeyDown}
              style={{ width: DIAMETER, height: DIAMETER }}
            >
              <img
                className="avatar-picker__photo"
                src={`/api/libraries/${libraryId}/thumb/${chosen.id}?size=preview`}
                alt=""
                draggable={false}
                style={transform}
                onLoad={(event) =>
                  setNatural({ w: event.currentTarget.naturalWidth || 1, h: event.currentTarget.naturalHeight || 1 })
                }
              />
            </div>
            <label className="avatar-picker__zoom">
              Zoom
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(event) => applyZoom(Number(event.target.value))}
              />
            </label>
            {saveError && (
              <p role="alert" className="avatar-picker__error">
                {saveError}
              </p>
            )}
            <div className="avatar-picker__actions">
              <button type="button" disabled={saving} onClick={() => setChosen(null)}>
                Choose another photo
              </button>
              <button type="button" className="avatar-picker__save" disabled={saving || !natural} onClick={save}>
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
