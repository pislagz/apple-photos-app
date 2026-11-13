import type { AlbumNode } from "../../api";
import { Icon } from "../icons";

// Up to four photo ids to show for an album or folder: its own cover, else the
// covers of what it holds (folders, and albums without a key photo).
export function coverIds(node: AlbumNode, limit = 4): string[] {
  if (node.cover_id) return [node.cover_id];
  const found: string[] = [];
  const walk = (children: AlbumNode[]) => {
    for (const child of children) {
      if (found.length >= limit) return;
      if (child.cover_id) found.push(child.cover_id);
      else walk(child.children);
    }
  };
  walk(node.children);
  return found;
}

// A square cover: one photo, a 2x2 mosaic (2 px gaps) once four are known (fewer
// would leave grey squares, so the first photo stands alone), or a plain tile
// with an icon when the album has nothing to show.
export default function AlbumCover({
  libraryId,
  node,
  size = "grid2x",
}: {
  libraryId: number;
  node: AlbumNode;
  size?: "grid" | "grid2x";
}) {
  const ids = coverIds(node);
  const src = (id: string) => `/api/libraries/${libraryId}/thumb/${id}?size=${size}`;
  if (ids.length === 0) {
    return (
      <span className="album-cover album-cover--empty">
        <Icon name={node.kind === "folder" ? "folder" : "albums"} size={32} />
      </span>
    );
  }
  if (ids.length < 4) {
    return (
      <span className="album-cover">
        <img className="album-cover__img" src={src(ids[0])} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className="album-cover album-cover--mosaic">
      {[0, 1, 2, 3].map((i) =>
        ids[i] ? (
          <img key={i} className="album-cover__img" src={src(ids[i])} alt="" loading="lazy" />
        ) : (
          <span key={i} className="album-cover__blank" />
        ),
      )}
    </span>
  );
}
