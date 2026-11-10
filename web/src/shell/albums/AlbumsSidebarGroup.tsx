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
  currentId,
  onOpen,
}: {
  // Owned by the sidebar, which also needs it for Media Types (one request).
  state: AlbumsState;
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
  return <AlbumTree nodes={albums.tree} currentId={currentId} onOpen={onOpen} />;
}

function AlbumTree({
  nodes,
  currentId,
  onOpen,
}: {
  nodes: AlbumNode[];
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const folders = useClosedFolders();
  return <AlbumList nodes={nodes} depth={0} currentId={currentId} onOpen={onOpen} folders={folders} />;
}

// Small right-pointing triangle; CSS turns it down when the folder is open.
function Disclosure() {
  return (
    <svg className="sidebar__disclosure" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M2 .8 6.4 4 2 7.2Z" fill="currentColor" />
    </svg>
  );
}

function AlbumList({
  nodes,
  depth,
  currentId,
  onOpen,
  folders,
}: {
  nodes: AlbumNode[];
  depth: number;
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
              <Icon name="albums" className="sidebar__icon" filled={currentId === node.id} />
              {node.title}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
