import { useState } from "react";
import { dismissUpdatedNote, type UpdatedNote } from "../../api";
import { Icon } from "../icons";

export function updatedNoteText(note: UpdatedNote): string {
  return `Library updated · +${note.added.toLocaleString()} added, −${note.removed.toLocaleString()} removed`;
}

// Dismissible once-per-user banner above the library grid. The dismissal is
// stored on the server (so it follows the user across devices); `onDismissed`
// lets the shell refresh `/api/me` so the banner stays gone after navigation.
export function LibraryUpdatedNote({
  libraryId,
  note,
  variant,
  onDismissed,
}: {
  libraryId: number;
  note: UpdatedNote;
  variant: "desktop" | "mobile";
  onDismissed?: () => void;
}) {
  const [hiddenRun, setHiddenRun] = useState<number | null>(null);
  if (hiddenRun === note.run_id) return null;

  function dismiss() {
    setHiddenRun(note.run_id);
    dismissUpdatedNote(libraryId, note.run_id)
      .then(() => onDismissed?.())
      .catch(() => undefined); // still hidden here; the server shows it again next load
  }

  return (
    <div className={`library-note library-note--${variant}`} role="status" data-testid="library-updated-note">
      <span className="library-note__text">{updatedNoteText(note)}</span>
      <button type="button" className="library-note__close" aria-label="Dismiss library update note" onClick={dismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

// Stacks the banner above the library view without changing the view's own
// full-height layout.
export function LibraryNoteFrame({
  libraryId,
  note,
  variant,
  onDismissed,
  children,
}: {
  libraryId: number;
  note: UpdatedNote | null | undefined;
  variant: "desktop" | "mobile";
  onDismissed?: () => void;
  children: React.ReactNode;
}) {
  // The wrapper is always rendered so dismissing never remounts the view.
  return (
    <div className="library-note-frame">
      {note && <LibraryUpdatedNote libraryId={libraryId} note={note} variant={variant} onDismissed={onDismissed} />}
      <div className="library-note-frame__body">{children}</div>
    </div>
  );
}
