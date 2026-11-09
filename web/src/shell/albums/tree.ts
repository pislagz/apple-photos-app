import type { AlbumNode } from "../../api";

// Depth-first lookup of a folder or album by id in the `/albums` tree.
export function findNode(nodes: AlbumNode[], id: string): AlbumNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inside = findNode(node.children, id);
    if (inside) return inside;
  }
  return null;
}

// Ids of the folders from the top down to (and excluding) `id`'s own node.
export function pathTo(nodes: AlbumNode[], id: string, trail: AlbumNode[] = []): AlbumNode[] | null {
  for (const node of nodes) {
    if (node.id === id) return trail;
    const inside = pathTo(node.children, id, [...trail, node]);
    if (inside) return inside;
  }
  return null;
}
