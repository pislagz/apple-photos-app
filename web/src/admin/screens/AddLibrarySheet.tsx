import { useState } from "react";
import InfoButton from "../../help/InfoButton";
import { addLibrary, type LibraryResponse } from "../api";
import { describeError } from "../sharing";
import { GroupedList, Row } from "../ui/GroupedList";
import Sheet from "../ui/Sheet";
import LibraryPicker, { type PickedFile } from "./LibraryPicker";

const SUFFIX = /\.photoslibrary$/i;

// "Add Library…": step 1 picks a package from the connected folders, step 2 names it.
// A typed path stays available under Advanced for libraries outside any folder.
export default function AddLibrarySheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (library: LibraryResponse) => void;
}) {
  const [chosen, setChosen] = useState<PickedFile | null>(null);
  const [name, setName] = useState("");
  const [typedPath, setTypedPath] = useState("");
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultName = chosen ? chosen.name.replace(SUFFIX, "") : "";

  async function add(path: string, displayName: string | undefined) {
    setError(null);
    setBusy(true);
    try {
      onAdded(await addLibrary(path, displayName));
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p role="alert" className="admin-sheet__error">
      {error}
    </p>
  );

  if (chosen) {
    return (
      <Sheet
        title="Add Library"
        onClose={onClose}
        actions={[
          {
            label: "Add Library",
            disabled: busy || name.trim() === "",
            onClick: () => void add(chosen.path, name.trim() === defaultName ? undefined : name.trim()),
          },
        ]}
      >
        {errorLine}
        <GroupedList footer="This is the name people see in the app. You can change it later.">
          <Row
            label={
              <label htmlFor="new-library-name">Name</label>
            }
            control={<input id="new-library-name" className="admin-input" value={name} onChange={(event) => setName(event.target.value)} data-autofocus />}
          />
        </GroupedList>
        <button type="button" className="admin-btn" onClick={() => (setChosen(null), setError(null))}>
          Choose a Different Library
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Add Library" cancelLabel="Close" onClose={onClose} actions={[]}>
      <p>
        Pick a Photos library from your folders. Adding it only lets this app read it; the library files are never changed.{" "}
        <InfoButton helpKey="libAdd" name="adding a library" />
      </p>
      {errorLine}
      <LibraryPicker
        refreshKey={0}
        onError={setError}
        onPick={(file) => {
          setError(null);
          setChosen(file);
          setName(file.name.replace(SUFFIX, ""));
        }}
      >
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add(typedPath, typedName.trim() === "" ? undefined : typedName);
          }}
        >
          <label className="admin-field">
            Path
            <input className="admin-input" value={typedPath} onChange={(event) => setTypedPath(event.target.value)} placeholder="/libraries/Family.photoslibrary" />
          </label>
          <label className="admin-field">
            Name (optional)
            <input className="admin-input" value={typedName} onChange={(event) => setTypedName(event.target.value)} />
          </label>
          <button type="submit" className="admin-btn admin-btn--primary" disabled={busy || typedPath.trim() === ""}>
            Add by Path
          </button>
        </form>
      </LibraryPicker>
    </Sheet>
  );
}
