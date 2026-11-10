import type { AlbumNode } from "../../api";
import { Icon } from "../icons";
import MobileLibrary from "../library/MobileLibrary";
import { findNode, pathTo } from "./tree";
import { useAlbums } from "./useAlbums";

// P2.1: the phone Albums tab. User-created albums and the folder tree only --
// smart albums live under More > Media Types (docs/SPEC.md). A folder drills
// into its own list; an album opens its photos in the regular All Photos grid
// and Viewer. Each level has its own route (`route.ts`), so back/forward work.
export default function AlbumsTab({
  libraryId,
  folderId,
  albumId,
  onNavigate,
}: {
  libraryId: number;
  folderId?: string;
  albumId?: string;
  onNavigate: (path: string) => void;
}) {
  const { albums, error, retry } = useAlbums(libraryId);

  if (error) {
    return (
      <div className="mobile-screen">
        <header className="mobile-screen__header mobile-screen__header--root">
          <h1 className="mobile-screen__title">Albums</h1>
        </header>
        <div className="mobile-screen__body" role="alert">
          <p>Couldn't load albums.</p>
          <button type="button" className="mobile-library__retry" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!albums) {
    return (
      <div className="mobile-screen">
        <header className="mobile-screen__header mobile-screen__header--root">
          <h1 className="mobile-screen__title">Albums</h1>
        </header>
        <div className="mobile-screen__body">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (albumId) {
    const album = findNode(albums.tree, albumId);
    // The back target is the album's own folder, so Back retraces the drill-down.
    const parent = album ? (pathTo(albums.tree, albumId) ?? []).at(-1) : undefined;
    const backPath = parent ? `/albums/folder/${encodeURIComponent(parent.id)}` : "/albums";
    return (
      <AlbumPhotos
        libraryId={libraryId}
        albumId={albumId}
        title={album?.title ?? "Album"}
        backLabel={parent?.title ?? "Albums"}
        onBack={() => onNavigate(backPath)}
      />
    );
  }

  const folder = folderId ? findNode(albums.tree, folderId) : null;
  const rows = folderId ? (folder?.children ?? []) : albums.tree;
  const parent = folderId ? (pathTo(albums.tree, folderId) ?? []).at(-1) : undefined;
  return (
    <div className="mobile-screen">
      <header className={`mobile-screen__header${folderId ? "" : " mobile-screen__header--root"}`}>
        {folderId && (
          <button
            type="button"
            className="mobile-screen__back"
            onClick={() => onNavigate(parent ? `/albums/folder/${encodeURIComponent(parent.id)}` : "/albums")}
          >
            <Icon name="chevron" className="mobile-screen__back-icon" />
            {parent?.title ?? "Albums"}
          </button>
        )}
        <h1 className="mobile-screen__title">{folderId ? (folder?.title ?? "Folder") : "Albums"}</h1>
      </header>
      <div className="mobile-screen__body">
        {rows.length === 0 ? (
          <p>{folderId ? "This folder is empty." : "No albums in this library."}</p>
        ) : (
          <ul className="albums-list">
            {rows.map((node) => (
              <li key={node.id}>
                <AlbumRow
                  libraryId={libraryId}
                  node={node}
                  onOpen={() =>
                    onNavigate(
                      node.kind === "folder"
                        ? `/albums/folder/${encodeURIComponent(node.id)}`
                        : `/albums/${encodeURIComponent(node.id)}`,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AlbumRow({ libraryId, node, onOpen }: { libraryId: number; node: AlbumNode; onOpen: () => void }) {
  return (
    <button type="button" className="albums-list__item" onClick={onOpen}>
      {node.cover_id ? (
        <img
          className="albums-list__cover"
          src={`/api/libraries/${libraryId}/thumb/${node.cover_id}?size=grid`}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="albums-list__cover albums-list__cover--empty">
          <Icon name={node.kind === "folder" ? "folder" : "albums"} />
        </span>
      )}
      <span className="albums-list__title">{node.title}</span>
      {node.count !== null && <span className="albums-list__count">{node.count.toLocaleString()}</span>}
      {node.kind === "folder" && <Icon name="chevron" className="albums-list__chevron" />}
    </button>
  );
}

// One album's photos: the regular All Photos grid and Viewer, filtered.
export function AlbumPhotos({
  libraryId,
  albumId,
  title,
  backLabel,
  onBack,
}: {
  libraryId: number;
  albumId: string;
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={onBack}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          {backLabel}
        </button>
        <h1 className="mobile-screen__title">{title}</h1>
      </header>
      <div className="mobile-screen__album-grid">
        <MobileLibrary key={albumId} libraryId={libraryId} album={albumId} />
      </div>
    </div>
  );
}
