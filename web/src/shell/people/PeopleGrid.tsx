import type { FaceCrop, Person } from "../../api";
import { Icon } from "../icons";
import { usePeople } from "./usePeople";

// Show the face with this much of the photo around it (1 = the face fills the circle).
const FACE_PADDING = 1.8;
// The grid2x thumb is 600px wide. The circle is at most this wide in CSS px
// (`.people-face` max-width in shell.css); keep the two in step.
const GRID2X_PX = 600;
const CIRCLE_MAX_CSS_PX = 140;

// A circular face crop: the same-origin thumbnail, scaled and shifted so the
// face rectangle is centred in the circle (no extra image route, so the CSP
// and the per-library access checks are the thumb route's own).
export function FaceCircle({ libraryId, cover }: { libraryId: number; cover: FaceCrop | null }) {
  if (!cover) {
    return (
      <span className="people-face people-face--empty">
        <Icon name="people" />
      </span>
    );
  }
  // The displayed image's aspect ratio is h/w of the face box (both are the
  // same pixel size divided by the image's width and height).
  const widthPct = 100 / (Math.max(cover.w, 0.001) * FACE_PADDING);
  const heightPct = widthPct * (cover.w / Math.max(cover.h, 0.001));
  // The face fills 1/FACE_PADDING of the circle, so it needs that many device
  // pixels; only when the grid2x thumb holds fewer of them (it would be
  // upscaled and blurry) is the larger preview worth generating.
  const neededFacePx = (CIRCLE_MAX_CSS_PX * (window.devicePixelRatio || 1)) / FACE_PADDING;
  const size = cover.w * GRID2X_PX < neededFacePx ? "preview" : "grid2x";
  return (
    <span className="people-face">
      <img
        className="people-face__img"
        src={`/api/libraries/${libraryId}/thumb/${cover.asset_id}?size=${size}`}
        alt=""
        loading="lazy"
        style={{
          width: `${widthPct}%`,
          left: `${50 - cover.x * widthPct}%`,
          top: `${50 - cover.y * heightPct}%`,
        }}
      />
    </span>
  );
}

// P2.2: the grid of circular faces with names, shared by both layouts.
export default function PeopleGrid({
  libraryId,
  onOpen,
  currentId,
}: {
  libraryId: number;
  onOpen: (person: Person) => void;
  currentId?: string | null;
}) {
  const { people, error, retry } = usePeople(libraryId);
  if (error) {
    return (
      <div role="alert" className="people-grid__note">
        <p>Couldn't load people.</p>
        <button type="button" className="mobile-library__retry" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }
  if (!people) return <p className="people-grid__note">Loading…</p>;
  if (people.length === 0) return <p className="people-grid__note">No people in this library.</p>;
  return (
    <ul className="people-grid">
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className="people-grid__item"
              aria-current={currentId === person.id ? "page" : undefined}
              onClick={() => onOpen(person)}
            >
              <FaceCircle libraryId={libraryId} cover={person.cover} />
              <span className={person.name === null ? "people-grid__name people-grid__name--unnamed" : "people-grid__name"}>
                {person.label}
              </span>
              <span className="people-grid__count">{person.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
  );
}
