import type { LibrarySummary } from "../api";

// Shared between the bottom of the phone's More tab and the bottom of the
// Mac sidebar (#90, tracker R21: switching is rare, so it sits low-key at
// the very bottom of each, not in the account menu). A single library -- by
// far the common case -- gets a plain label; a native <select> only shows up
// once there's something to pick.
export default function LibrarySwitcher({
  libraries,
  activeLibraryId,
  onChange,
  className,
}: {
  libraries: LibrarySummary[];
  activeLibraryId: number | undefined;
  onChange: (id: number) => void;
  className: string;
}) {
  // No library: nothing to name or switch, so no stray "Library" caption (#263).
  if (libraries.length === 0) return null;
  const activeName = libraries.find((library) => library.id === activeLibraryId)?.display_name ?? libraries[0].display_name;

  if (libraries.length === 1) {
    return (
      <div className={className} aria-label="Library switcher">
        {activeName}
      </div>
    );
  }

  return (
    <div className={className}>
      <label>
        <span className="sr-only">Library switcher</span>
        <select value={activeLibraryId ?? ""} onChange={(event) => onChange(Number(event.target.value))}>
          {libraries.map((library) => (
            <option key={library.id} value={library.id}>
              {library.display_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
