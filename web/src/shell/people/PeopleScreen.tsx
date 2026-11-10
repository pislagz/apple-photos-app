import { PERSON_PREFIX } from "../../api";
import { Icon } from "../icons";
import MobileLibrary from "../library/MobileLibrary";
import PeopleGrid, { UNNAMED_PERSON } from "./PeopleGrid";
import { usePeople } from "./usePeople";

// P2.2: More > People & Pets. `/people` is the grid of faces; `/people/<id>`
// is one person's photos in the regular All Photos grid and Viewer.
export default function PeopleScreen({
  libraryId,
  personId,
  onNavigate,
}: {
  libraryId: number;
  personId?: string;
  onNavigate: (path: string) => void;
}) {
  if (personId) return <PersonPhotos libraryId={libraryId} personId={personId} onNavigate={onNavigate} />;
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={() => onNavigate("/more")}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          More
        </button>
        <h1 className="mobile-screen__title">People & Pets</h1>
      </header>
      <div className="mobile-screen__body">
        <PeopleGrid libraryId={libraryId} onOpen={(p) => onNavigate(`/people/${encodeURIComponent(p.id)}`)} />
      </div>
    </div>
  );
}

function PersonPhotos({
  libraryId,
  personId,
  onNavigate,
}: {
  libraryId: number;
  personId: string;
  onNavigate: (path: string) => void;
}) {
  // A deep link reload has no list in memory; the title comes from the same
  // `/people` call (an id that isn't listed gets the grid's empty page).
  const { people } = usePeople(libraryId);
  const person = people?.find((p) => p.id === personId);
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={() => onNavigate("/people")}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          People & Pets
        </button>
        <h1 className="mobile-screen__title">{person ? (person.name ?? UNNAMED_PERSON) : "Person"}</h1>
      </header>
      <div className="mobile-screen__album-grid">
        <MobileLibrary key={personId} libraryId={libraryId} album={`${PERSON_PREFIX}${personId}`} />
      </div>
    </div>
  );
}
