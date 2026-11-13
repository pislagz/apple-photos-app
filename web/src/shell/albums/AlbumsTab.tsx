import type { AlbumNode, AlbumsResponse } from "../../api";
import { Icon } from "../icons";
import MobileLibrary from "../library/MobileLibrary";
import { MEDIA_TYPES } from "../more/mediaTypes";
import { PersonButton } from "../people/PeopleGrid";
import { usePeople } from "../people/usePeople";
import AlbumCover from "./AlbumCover";
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

  if (!folderId) {
    return <AlbumsHome libraryId={libraryId} albums={albums} onNavigate={onNavigate} />;
  }
  const folder = findNode(albums.tree, folderId);
  const rows = folder?.children ?? [];
  const parent = (pathTo(albums.tree, folderId) ?? []).at(-1);
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button
          type="button"
          className="mobile-screen__back"
          onClick={() => onNavigate(parent ? `/albums/folder/${encodeURIComponent(parent.id)}` : "/albums")}
        >
          <Icon name="chevron" className="mobile-screen__back-icon" />
          {parent?.title ?? "Albums"}
        </button>
        <h1 className="mobile-screen__title">{folder?.title ?? "Folder"}</h1>
      </header>
      <div className="mobile-screen__body">
        {rows.length === 0 ? (
          <p>This folder is empty.</p>
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

function openPath(node: AlbumNode): string {
  return node.kind === "folder"
    ? `/albums/folder/${encodeURIComponent(node.id)}`
    : `/albums/${encodeURIComponent(node.id)}`;
}

function SectionHeading({ title, onOpen }: { title: string; onOpen?: () => void }) {
  return onOpen ? (
    <h2 className="albums-home__heading">
      <button type="button" className="albums-home__heading-button" onClick={onOpen}>
        {title}
        <Icon name="chevron" size={20} className="albums-home__chevron" />
      </button>
    </h2>
  ) : (
    <h2 className="albums-home__heading">{title}</h2>
  );
}

// The iOS Photos "Albums" tab: sections, each a row of square cards you
// scroll sideways. Media Types is a grouped list.
function AlbumsHome({
  libraryId,
  albums,
  onNavigate,
}: {
  libraryId: number;
  albums: AlbumsResponse;
  onNavigate: (path: string) => void;
}) {
  const { people } = usePeople(libraryId);
  const types = MEDIA_TYPES.filter((type) => albums.smart.some((album) => album.id === `smart:${type.slug}`));
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">Albums</h1>
      </header>
      <div className="mobile-screen__body albums-home">
        <section aria-label="My Albums">
          <SectionHeading title="My Albums" />
          {albums.tree.length === 0 ? (
            <p className="albums-home__empty">There are no albums in this library yet.</p>
          ) : (
            <ul className="albums-home__row">
              {albums.tree.map((node) => (
                <li key={node.id}>
                  <button type="button" className="album-card" onClick={() => onNavigate(openPath(node))}>
                    <AlbumCover libraryId={libraryId} node={node} />
                    <span className="album-card__title">{node.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {people && people.length > 0 && (
          <section aria-label="People & Pets">
            <SectionHeading title="People & Pets" onOpen={() => onNavigate("/people")} />
            <ul className="albums-home__row albums-home__row--people">
              {people.slice(0, 20).map((person) => (
                <li key={person.id}>
                  <PersonButton
                    libraryId={libraryId}
                    person={person}
                    onOpen={(p) => onNavigate(`/people/${encodeURIComponent(p.id)}`)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Places">
          <SectionHeading title="Places" onOpen={() => onNavigate("/places")} />
          <ul className="albums-home__row">
            <li>
              <button type="button" className="album-card album-card--places" onClick={() => onNavigate("/places")}>
                <span className="album-cover album-cover--empty">
                  <Icon name="map" size={32} />
                </span>
                <span className="album-card__title">Map</span>
              </button>
            </li>
          </ul>
        </section>
        {types.length > 0 && (
          <section aria-label="Media Types">
            <SectionHeading title="Media Types" />
            <ul className="albums-list">
              {types.map((type) => (
                <li key={type.slug}>
                  <button type="button" className="albums-list__item" onClick={() => onNavigate(`/media/${type.slug}`)}>
                    <Icon name={type.icon} className="albums-list__type-icon" size={22} />
                    <span className="albums-list__title">{type.label}</span>
                    <Icon name="chevron" className="albums-list__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
