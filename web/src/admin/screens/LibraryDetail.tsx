import { useState } from "react";
import InfoButton from "../../help/InfoButton";
import { libraryStatus, reindexLibrary, removeLibrary, renameLibrary, type LibraryResponse, type LibraryStatusResponse } from "../api";
import { photoCount, runSentence, statusKind, statusWord, TRIGGER_WORDS, warningText } from "../libraryStatus";
import { describeError } from "../sharing";
import { GroupedList, Row } from "../ui/GroupedList";
import SavedStatus, { useSaveStatus } from "../ui/SavedStatus";
import Sheet from "../ui/Sheet";
import SkeletonRow from "../ui/SkeletonRow";
import { formatBytes, formatWhen } from "../ui/format";
import { IndexBar } from "./IndexBar";
import PrewarmControls from "./PrewarmControls";
import ReplaceDialog from "./ReplaceDialog";

const HISTORY_LIMIT = 10;

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export default function LibraryDetail({
  library,
  status,
  onStatus,
  onChanged,
  onRemoved,
  onError,
}: {
  library: LibraryResponse;
  status: LibraryStatusResponse | undefined;
  onStatus: (status: LibraryStatusResponse) => void;
  onChanged: () => void;
  onRemoved: () => void;
  onError: (message: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(library.display_name);
  const [replacing, setReplacing] = useState<{ path: string; name: string } | "choose" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const save = useSaveStatus();
  const check = useSaveStatus();

  if (!status) {
    return (
      <GroupedList>
        <SkeletonRow />
        <SkeletonRow />
      </GroupedList>
    );
  }

  const kind = statusKind(status);
  const runs = (status.runs ?? []).slice(0, HISTORY_LIMIT);
  const suggestion = status.suggestion ?? null;
  const alternatives = suggestion ? (status.alternatives ?? []) : [];
  const failed = status.index_state === "error";

  async function rename() {
    const next = name.trim();
    if (next === "") return;
    if (next === library.display_name) return setRenaming(false);
    if (await save.run(() => renameLibrary(library.id, next))) {
      setRenaming(false);
      onChanged();
    }
  }

  async function checkNow() {
    onError(null);
    await check.run(async () => onStatus(await reindexLibrary(library.id)));
  }

  async function remove() {
    setRemoving(false);
    try {
      await removeLibrary(library.id);
      onRemoved();
    } catch (err) {
      onError(describeError(err));
    }
  }

  async function replaced() {
    setReplacing(null);
    onChanged();
    try {
      onStatus(await libraryStatus(library.id));
    } catch (err) {
      onError(describeError(err));
    }
  }

  const notes: React.ReactNode[] = [];
  if (failed) {
    notes.push(
      <Row
        key="index-error"
        label={<span role="alert">Reading this library failed: {status.index_error ?? "unknown error"}. Check that it is still there, then check for changes.</span>}
      />,
    );
  }
  for (const warning of status.warnings) {
    notes.push(<Row key={warning.code} label={<span role="alert">{warningText(warning)}</span>} />);
  }
  if (status.updating) {
    notes.push(<Row key="updating" label="Being updated" detail={status.updating_reason ?? undefined} />);
  }
  if (suggestion) {
    notes.push(
      <Row
        key="suggestion"
        label={suggestion.message}
        control={
          <button type="button" className="admin-btn admin-btn--primary" onClick={() => setReplacing({ path: suggestion.path, name: suggestion.name })}>
            Replace with {suggestion.name}
          </button>
        }
      />,
    );
  }

  return (
    <>
      <GroupedList>
        <Row
          label="Status"
          value={statusWord(status)}
          detail={
            status.index_state === "indexing" && status.index_progress && status.index_progress.total > 0 ? (
              <span role="status">
                Reading photos… {status.index_progress.done.toLocaleString()} of {status.index_progress.total.toLocaleString()}
                <IndexBar status={status} />
              </span>
            ) : status.index_state === "indexing" || kind === "indexing" ? (
              <span role="status">
                Reading photos…
                <IndexBar status={status} />
              </span>
            ) : undefined
          }
        />
        {renaming ? (
          <form
            role="listitem"
            className="admin-row admin-row--form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <span className="admin-row__text">
              <label className="admin-row__label" htmlFor="library-name">
                Name
              </label>
            </span>
            <span className="admin-row__control">
              <input id="library-name" className="admin-input" value={name} onChange={(event) => setName(event.target.value)} data-autofocus />
              <button type="submit" className="admin-btn admin-btn--primary" disabled={name.trim() === ""}>
                Done
              </button>
              <button
                type="button"
                className="admin-btn"
                onClick={() => {
                  setName(library.display_name);
                  setRenaming(false);
                }}
              >
                Cancel
              </button>
            </span>
          </form>
        ) : (
          <Row
            label={
              <>
                Name <InfoButton helpKey="libRename" name="rename" />
              </>
            }
            value={library.display_name}
            control={
              <>
                <button type="button" className="admin-btn" onClick={() => setRenaming(true)}>
                  Rename
                </button>
                <SavedStatus state={save.state} message={save.error} />
              </>
            }
          />
        )}
        <Row label="Photos" value={status.asset_count === null ? "—" : photoCount(status.asset_count).replace(/ photos?$/, "")} />
        <Row label="Videos" value={status.video_count === null ? "—" : status.video_count.toLocaleString()} />
        <Row label="People" value={status.people_count === null ? "—" : status.people_count.toLocaleString()} />
        <Row label="Size on disk" value={status.total_size_bytes ? formatBytes(status.total_size_bytes) : "—"} />
        <Row label="Location" value={<span title={library.path}>{fileName(library.path)}</span>} />
        <Row label="Last updated" value={status.last_indexed_at ? formatWhen(status.last_indexed_at) : "Not read yet"} />
        <Row label="Added to this app" value={formatWhen(library.created_at)} />
      </GroupedList>

      {notes.length > 0 && <GroupedList heading="Status" label="Library notes">{notes}</GroupedList>}

      {alternatives.length > 0 && (
        <GroupedList heading="Other libraries next to it" label="Other candidates">
          {alternatives.map((candidate) => (
            <Row
              key={candidate.path}
              label={candidate.name}
              control={
                <button type="button" className="admin-btn" onClick={() => setReplacing({ path: candidate.path, name: candidate.name })}>
                  Replace with {candidate.name}
                </button>
              }
            />
          ))}
        </GroupedList>
      )}

      <GroupedList heading="Thumbnails" footer="Thumbnails are the small previews people scroll through.">
        <PrewarmControls key={`${library.id}-${status.prewarm?.state}`} libraryId={library.id} initial={status.prewarm} cacheBytes={status.thumb_cache_bytes} />
      </GroupedList>

      <GroupedList heading="Maintenance" footer="Your library files are only read. Nothing in them is changed.">
        <Row
          label={
            <>
              Check for Changes <InfoButton helpKey="libCheck" name="check for changes" />
            </>
          }
          detail="Looks for photos added or removed since the last check."
          control={
            <>
              <button type="button" className="admin-btn" disabled={check.state === "saving"} onClick={() => void checkNow()}>
                Check Now
              </button>
              <SavedStatus state={check.state === "saved" ? "idle" : check.state} message={check.error} />
            </>
          }
        />
        <Row
          label={
            <>
              Replace Library File <InfoButton helpKey="libReplace" name="replace library file" />
            </>
          }
          detail="Use a newer or moved copy of this library."
          control={
            <button type="button" className="admin-btn" onClick={() => setReplacing("choose")}>
              Replace…
            </button>
          }
        />
      </GroupedList>

      {runs.length > 0 && (
        <GroupedList heading="Updates">
          <Row
            label={
              <>
                Recent updates <InfoButton helpKey="libHistory" name="recent updates" />
              </>
            }
            value={String(runs.length)}
            control={
              <button type="button" className="admin-btn" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Hide" : "Show"}
              </button>
            }
          />
          {showHistory && (
            <div role="list" aria-label="Update history" className="admin-subgroup">
              {runs.map((run) => (
                <Row
                  key={run.id}
                  label={runSentence(run)}
                  detail={`${formatWhen(run.started_at)} · ${TRIGGER_WORDS[run.trigger] ?? "Checked"}`}
                />
              ))}
            </div>
          )}
        </GroupedList>
      )}

      <GroupedList footer="Takes the library out of this app only. Your photos and the library file stay where they are.">
        <Row
          destructive
          label={
            <>
              Remove Library from App <InfoButton helpKey="libRemove" name="remove library" />
            </>
          }
          control={
            <button type="button" className="admin-btn admin-btn--danger" onClick={() => setRemoving(true)}>
              Remove…
            </button>
          }
        />
      </GroupedList>

      {removing && (
        <Sheet title={`Remove “${library.display_name}”?`} onClose={() => setRemoving(false)} actions={[{ label: "Remove Library", kind: "destructive", onClick: () => void remove() }]}>
          <p>
            People will no longer be able to see it in this app. Your photos and the library file are not deleted. Sharing choices for this library will be
            forgotten.
          </p>
        </Sheet>
      )}

      {replacing !== null && (
        <ReplaceDialog
          library={library}
          initial={replacing === "choose" ? undefined : replacing}
          suggestions={suggestion ? [suggestion] : []}
          onClose={() => setReplacing(null)}
          onReplaced={() => void replaced()}
        />
      )}
    </>
  );
}
