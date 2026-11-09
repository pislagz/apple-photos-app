import type { AlbumNode } from "../../api";
import { Icon } from "../icons";
import { useAlbums } from "./useAlbums";

// P2.1: the desktop sidebar's Albums group -- the folder tree as nested
// disclosure rows, albums as leaves. Loading and failure show inside the
// group (with Retry) so the rest of the sidebar stays usable.
export default function AlbumsSidebarGroup({
  libraryId,
  currentId,
  onOpen,
}: {
  libraryId: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  const { albums, error, retry } = useAlbums(libraryId);
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
  return <AlbumList nodes={albums.tree} depth={0} currentId={currentId} onOpen={onOpen} />;
}

function AlbumList({
  nodes,
  depth,
  currentId,
  onOpen,
}: {
  nodes: AlbumNode[];
  depth: number;
  currentId: string | null;
  onOpen: (id: string, title: string) => void;
}) {
  return (
    <ul>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <li key={node.id}>
            <details open className="sidebar__folder">
              <summary className="sidebar__item sidebar__item--sub" style={{ paddingLeft: 22 + depth * 12 }}>
                <Icon name="folder" className="sidebar__icon" />
                {node.title}
              </summary>
              <AlbumList nodes={node.children} depth={depth + 1} currentId={currentId} onOpen={onOpen} />
            </details>
          </li>
        ) : (
          <li key={node.id}>
            <button
              type="button"
              aria-current={currentId === node.id ? "page" : undefined}
              className="sidebar__item sidebar__item--sub"
              style={{ paddingLeft: 22 + depth * 12 }}
              onClick={() => onOpen(node.id, node.title)}
            >
              <Icon name="albums" className="sidebar__icon" />
              {node.title}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
