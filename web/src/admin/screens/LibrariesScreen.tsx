import { useCallback, useEffect, useState } from "react";
import InfoButton from "../../help/InfoButton";
import { Icon } from "../../shell/icons";
import { libraryStatus, listLibraries, type LibraryResponse, type LibraryStatusResponse } from "../api";
import { isIndexing, rowSummary } from "../libraryStatus";
import { describeError } from "../sharing";
import { Footer, GroupedList, Row } from "../ui/GroupedList";
import SkeletonRow from "../ui/SkeletonRow";
import { formatWhen } from "../ui/format";
import AddLibrarySheet from "./AddLibrarySheet";
import LibraryDetail from "./LibraryDetail";
import { IndexBar } from "./IndexBar";
import { ConnectHelp } from "./LibraryPicker";

const INDEX_POLL_MS = 2000;

export default function LibrariesScreen({
  selected = null,
  onSelect,
}: {
  /** The open library's id, from the #libraries/<id> hash. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const [libraries, setLibraries] = useState<LibraryResponse[] | null>(null);
  const [statuses, setStatuses] = useState<Record<number, LibraryStatusResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Used on its own (tests), the screen keeps the open library itself.
  const [local, setLocal] = useState<string | null>(null);
  const open = onSelect === undefined ? local : selected;
  const select = onSelect ?? setLocal;

  const loadStatus = useCallback((id: number) => {
    libraryStatus(id)
      .then((status) => setStatuses((prev) => ({ ...prev, [id]: status })))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  const refresh = useCallback(() => {
    listLibraries()
      .then((list) => {
        setLibraries(list);
        // Every row shows its state straight away; there is no "Load status".
        for (const library of list) loadStatus(library.id);
      })
      .catch((err: unknown) => setError(describeError(err)));
  }, [loadStatus]);

  useEffect(refresh, [refresh]);

  // Light polling while any library is being read; stops once none is.
  const indexingIds = (libraries ?? [])
    .filter((library) => isIndexing(statuses[library.id]))
    .map((library) => library.id)
    .join(",");
  useEffect(() => {
    if (!indexingIds) return;
    const timer = window.setInterval(() => {
      for (const id of indexingIds.split(",").map(Number)) {
        libraryStatus(id)
          .then((status) => setStatuses((prev) => ({ ...prev, [id]: status })))
          .catch(() => {});
      }
    }, INDEX_POLL_MS);
    return () => window.clearInterval(timer);
  }, [indexingIds]);

  const library = open === null ? null : (libraries?.find((l) => String(l.id) === open) ?? null);

  if (open !== null && libraries !== null && library === null) {
    return (
      <section className="admin-libraries">
        <button type="button" className="admin-btn admin-back" onClick={() => select(null)}>
          ‹ Libraries
        </button>
        <h1>Library not found</h1>
        <p className="admin-hint">This library is not in the app any more. It may have been removed.</p>
      </section>
    );
  }

  if (library !== null) {
    return (
      <section className="admin-libraries">
        <button type="button" className="admin-btn admin-back" onClick={() => select(null)}>
          ‹ Libraries
        </button>
        <h1>{library.display_name}</h1>
        {error && <p role="alert">{error}</p>}
        <LibraryDetail
          library={library}
          status={statuses[library.id]}
          onStatus={(status) => setStatuses((prev) => ({ ...prev, [library.id]: status }))}
          onChanged={refresh}
          onRemoved={() => {
            select(null);
            refresh();
          }}
          onError={setError}
        />
      </section>
    );
  }

  const added = (created: LibraryResponse) => {
    setAdding(false);
    refresh();
    select(String(created.id));
  };

  return (
    <section className="admin-libraries">
      <h1>Libraries</h1>
      {error && <p role="alert">{error}</p>}

      {libraries === null ? (
        <GroupedList>
          <SkeletonRow />
          <SkeletonRow />
        </GroupedList>
      ) : libraries.length === 0 ? (
        <div className="admin-empty" data-testid="libraries-empty">
          <Icon name="library" size={40} />
          <h2>No libraries yet</h2>
          <p>Add a Photos library to start. The folder with your libraries has to be connected to the server first.</p>
          <div className="admin-actions-bar">
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => setAdding(true)}>
              Add Library…
            </button>
            <InfoButton helpKey="libAdd" name="adding a library" />
          </div>
          <ConnectHelp />
        </div>
      ) : (
        <>
          <GroupedList label="Libraries">
            {libraries.map((entry) => {
              const status = statuses[entry.id];
              return (
                <Row
                  key={entry.id}
                  label={entry.display_name}
                  detail={
                    <>
                      <span className="admin-row__line">{rowSummary(status)}</span>
                      <span className="admin-row__line">{status?.last_indexed_at ? `Updated ${formatWhen(status.last_indexed_at)}` : status ? "Not read yet" : ""}</span>
                      {status && <IndexBar status={status} />}
                    </>
                  }
                  onClick={() => select(String(entry.id))}
                />
              );
            })}
          </GroupedList>
          <div className="admin-actions-bar">
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => setAdding(true)}>
              Add Library…
            </button>
            <InfoButton helpKey="libAdd" name="adding a library" />
          </div>
          <Footer>Libraries are read-only. This app never changes, moves or deletes the files in a library.</Footer>
        </>
      )}

      {adding && <AddLibrarySheet onClose={() => setAdding(false)} onAdded={added} />}
    </section>
  );
}
