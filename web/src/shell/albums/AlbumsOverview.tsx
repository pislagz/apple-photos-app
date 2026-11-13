import { useState } from "react";
import type { AlbumNode } from "../../api";
import { Icon } from "../icons";
import AlbumCover from "./AlbumCover";
import { findNode, pathTo } from "./tree";
import { useAlbums } from "./useAlbums";

// Mac Photos' Albums screen: a grid of square covers with the name and photo
// count underneath. A folder opens in place (with a Back button); an album
// hands over to the shell, which shows its photos.
export default function AlbumsOverview({
  libraryId,
  onOpen,
}: {
  libraryId: number;
  onOpen: (node: AlbumNode) => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const { albums, error, retry } = useAlbums(libraryId);
  if (error) {
    return (
      <div role="alert" className="albums-overview__note">
        <p>Couldn't load albums.</p>
        <button type="button" className="mobile-library__retry" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }
  if (!albums) return <p className="albums-overview__note">Loading…</p>;
  const folder = folderId ? findNode(albums.tree, folderId) : null;
  const rows = folder ? folder.children : albums.tree;
  const parent = folder ? (pathTo(albums.tree, folder.id) ?? []).at(-1) : undefined;
  return (
    <div className="albums-overview">
      {folder && (
        <div className="albums-overview__crumb">
          <button type="button" className="toolbar-button" onClick={() => setFolderId(parent?.id ?? null)}>
            <Icon name="chevron" className="toolbar-button__back-icon" />
            {parent?.title ?? "Albums"}
          </button>
          <h2>{folder.title}</h2>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="albums-overview__note">
          {folder ? "This folder is empty." : "There are no albums in this library yet."}
        </p>
      ) : (
        <ul className="albums-overview__grid">
          {rows.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="album-tile"
                onClick={() => (node.kind === "folder" ? setFolderId(node.id) : onOpen(node))}
              >
                <AlbumCover libraryId={libraryId} node={node} />
                <span className="album-tile__name">{node.title}</span>
                <span className="album-tile__count">
                  {node.count === null
                    ? `${node.children.length.toLocaleString()} ${node.children.length === 1 ? "item" : "items"}`
                    : node.count.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
