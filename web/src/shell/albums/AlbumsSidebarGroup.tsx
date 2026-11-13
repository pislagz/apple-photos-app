import { useCallback, useState } from "react";
import type { AlbumNode } from "../../api";
import { Icon } from "../icons";
import type { AlbumsState } from "./useAlbums";

// P2.1: the desktop sidebar's Albums group -- the folder tree as nested
// disclosure rows, albums as leaves. Loading and failure show inside the
// group (with Retry) so the rest of the sidebar stays usable.
// Folders start open. Only the ones the user closed are remembered, so a new
// folder shows up open. Storage can be blocked (private mode); then it is
// session-only.
const FOLDERS_KEY = "photos-viewer.sidebar-closed-folders";
function readClosed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function useClosedFolders() {
  const [closed, setClosed] = useState(readClosed);
  const setOpen = useCallback((id: string, open: boolean) => {
    setClosed((prev) => {
      if (prev.has(id) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FOLDERS_KEY, JSON.stringify([...next]));
      } catch {
        /* session-only */
      }
      return next;
    });
  }, []);
  return { closed, setOpen };
}

export default function AlbumsSidebarGroup({
  state,
  libraryId,
  currentId,
  onOpen,
}: {
  // Owned by the sidebar, which also needs it for Media Types (one request).
  state: AlbumsState;
  libraryId: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const { albums, error, retry } = state;
  if (error) {
    return (
      <p className="sidebar__note" role="alert">
        Couldn't load albums.{" "}
        <button type="button" className="sidebar__retry" onClick={retry}>
          Retry
        </button>
      </p>
    );
  }
  if (!albums) return <p className="sidebar__note">Loading…</p>;
  if (albums.tree.length === 0) return <p className="sidebar__note">No albums</p>;
  return <AlbumTree nodes={albums.tree} libraryId={libraryId} currentId={currentId} onOpen={onOpen} />;
}

function AlbumTree({
  nodes,
  libraryId,
  currentId,
  onOpen,
}: {
  nodes: AlbumNode[];
  libraryId: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const folders = useClosedFolders();
  return <AlbumList nodes={nodes} depth={0} libraryId={libraryId} currentId={currentId} onOpen={onOpen} folders={folders} />;
}

// Thin stroked chevron (12 px box, 1.5 stroke) on folder rows. It is a row
// affordance, deliberately unlike the filled section-header triangles. Points
// right; CSS turns it down when the folder is open.
function Disclosure() {
  return (
    <svg
      className="sidebar__disclosure sidebar__chevron"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.4 2.6 7.8 6 4.4 9.4" />
    </svg>
  );
}

function AlbumList({
  nodes,
  depth,
  libraryId,
  currentId,
  onOpen,
  folders,
}: {
  nodes: AlbumNode[];
  depth: number;
  libraryId: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
  folders: ReturnType<typeof useClosedFolders>;
}) {
  return (
    <ul>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <li key={node.id}>
            <details
              open={!folders.closed.has(node.id)}
              className="sidebar__folder"
              onToggle={(e) => folders.setOpen(node.id, e.currentTarget.open)}
            >
              <summary className="sidebar__item sidebar__item--sub" style={{ paddingLeft: 8 + depth * 12 }}>
                <Disclosure />
                <Icon name="folder" className="sidebar__icon" />
                {node.title}
              </summary>
              <AlbumList
                nodes={node.children}
                depth={depth + 1}
                libraryId={libraryId}
                currentId={currentId}
                onOpen={onOpen}
                folders={folders}
              />
            </details>
          </li>
        ) : (
          <li key={node.id}>
            <button
              type="button"
              aria-current={currentId === node.id ? "page" : undefined}
              className="sidebar__item sidebar__item--sub"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onOpen(node.id, node.title)}
            >
              <span className="sidebar__disclosure-spacer" aria-hidden="true" />
              {node.cover_id ? (
                <img
                  className="sidebar__cover"
                  src={`/api/libraries/${libraryId}/thumb/${encodeURIComponent(node.cover_id)}?size=grid`}
                  alt=""
                  loading="lazy"
                  width={18}
                  height={18}
                />
              ) : (
                <Icon name="albums" className="sidebar__icon" filled={currentId === node.id} />
              )}
              {node.title}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
