import type { AlbumNode, Person, SummaryResponse } from "../../api";

// #225: what the Search UI keeps on the client. The server only understands
// `?q=` (every whitespace-separated word must match), so a token is just a
// label plus the words it sends.
export type TokenKind = "person" | "album" | "date" | "text";

export interface SearchToken {
  kind: TokenKind;
  label: string;
}

export const MAX_RECENTS = 8;
export const RECENTS_KEY = "pv.recentSearches";
// After this many tokens the chips show only their icon, as Photos does.
export const COLLAPSE_AFTER = 3;

// The query the server gets: every token's words, then the typed text.
export function buildQuery(tokens: SearchToken[], text: string): string {
  return [...tokens.map((t) => t.label), text]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function loadRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

// Newest first, de-duplicated ignoring case, at most MAX_RECENTS. Stored in
// this browser only; nothing is sent to the server.
export function addRecent(list: string[], query: string): string[] {
  const clean = query.trim().replace(/\s+/g, " ");
  if (!clean) return list;
  const key = clean.toLowerCase();
  return [clean, ...list.filter((q) => q.toLowerCase() !== key)].slice(0, MAX_RECENTS);
}

export function saveRecents(list: string[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(RECENTS_KEY);
    else localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: recents just don't persist */
  }
}

export interface SearchSources {
  people: Person[];
  albums: AlbumNode[];
  summary: SummaryResponse | null;
}

export interface Suggestion {
  key: string;
  kind: TokenKind;
  title: string;
  detail: string;
  // Set for people, so the row can show their face.
  person?: Person;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function flattenAlbums(nodes: AlbumNode[]): AlbumNode[] {
  return nodes.flatMap((n) => (n.kind === "folder" ? flattenAlbums(n.children) : [n]));
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function wordPrefix(text: string, term: string): boolean {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .some((w) => w.startsWith(term));
}

const PER_KIND = 4;

// Only what the server already provides: named people, albums, and the
// years/months that have photos. (Places and scene labels have no list
// endpoint, so they are reached by the plain "Search for" row.)
export function buildSuggestions(sources: SearchSources, text: string, tokens: SearchToken[]): Suggestion[] {
  const q = fold(text.trim());
  if (!q) return [];
  const taken = new Set(tokens.map((t) => `${t.kind}:${t.label.toLowerCase()}`));
  const terms = q.split(/\s+/);
  const matches = (title: string) => terms.every((t) => wordPrefix(title, t));
  const out: Suggestion[] = [];

  for (const person of sources.people
    .filter((p) => p.name && matches(p.name))
    .slice(0, PER_KIND)) {
    out.push({ key: `person:${person.id}`, kind: "person", title: person.name ?? person.label, detail: "Person", person });
  }
  for (const album of flattenAlbums(sources.albums)
    .filter((a) => matches(a.title))
    .slice(0, PER_KIND)) {
    out.push({
      key: `album:${album.id}`,
      kind: "album",
      title: album.title,
      detail: album.count === null ? "Album" : `Album · ${album.count.toLocaleString()}`,
    });
  }
  const dates = new Map<string, { title: string; count: number }>();
  for (const m of sources.summary?.months ?? []) {
    const [year, month] = m.key.split("-");
    const name = MONTHS[Number(month) - 1];
    if (name) dates.set(m.key, { title: `${name} ${year}`, count: m.count });
  }
  for (const y of sources.summary?.years ?? []) dates.set(y.key, { title: y.key, count: y.count });
  const dateHits = [...dates.entries()]
    .filter(([, d]) => matches(d.title))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, PER_KIND);
  for (const [key, d] of dateHits) {
    out.push({ key: `date:${key}`, kind: "date", title: d.title, detail: `Date · ${d.count.toLocaleString()}` });
  }
  return out.filter((s) => !taken.has(`${s.kind}:${s.title.toLowerCase()}`));
}
