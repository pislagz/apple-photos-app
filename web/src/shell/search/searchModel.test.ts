import { beforeEach, describe, expect, it } from "vitest";
import type { Person } from "../../api";
import {
  addRecent,
  buildQuery,
  buildSuggestions,
  loadRecents,
  MAX_RECENTS,
  RECENTS_KEY,
  saveRecents,
  type SearchSources,
} from "./searchModel";

beforeEach(() => localStorage.clear());

describe("recent searches", () => {
  it("keeps newest first and de-duplicates ignoring case", () => {
    let list: string[] = [];
    for (const q of ["dog", "Beach", "DOG", "  beach  "]) list = addRecent(list, q);
    expect(list).toEqual(["beach", "DOG"]);
  });

  it("keeps at most 8", () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = addRecent(list, `q${i}`);
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0]).toBe("q11");
    expect(list).not.toContain("q3");
  });

  it("ignores blank queries", () => {
    expect(addRecent(["a"], "   ")).toEqual(["a"]);
  });

  it("persists in localStorage and survives bad stored data", () => {
    saveRecents(["a", "b"]);
    expect(loadRecents()).toEqual(["a", "b"]);
    localStorage.setItem(RECENTS_KEY, "{not json");
    expect(loadRecents()).toEqual([]);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([1, "ok", ""]));
    expect(loadRecents()).toEqual(["ok"]);
    saveRecents([]);
    expect(localStorage.getItem(RECENTS_KEY)).toBeNull();
  });
});

describe("tokens", () => {
  it("builds one query out of tokens and typed text", () => {
    expect(buildQuery([{ kind: "person", label: "Anna Smith" }, { kind: "date", label: "March 2024" }], " dog ")).toBe(
      "Anna Smith March 2024 dog",
    );
    expect(buildQuery([], "  ")).toBe("");
  });
});

const person = (id: string, name: string | null): Person => ({ id, name, label: name ?? "Person A", count: 3, cover: null });
const sources: SearchSources = {
  people: [person("1", "Anna Smith"), person("2", null)],
  albums: [
    { id: "f", kind: "folder", title: "Trips", count: null, cover_id: null, children: [
      { id: "a1", kind: "album", title: "Annecy 2023", count: 12, cover_id: null, children: [] },
    ] },
  ],
  summary: {
    years: [{ key: "2024", count: 40, key_asset_ids: [] }],
    months: [{ key: "2024-03", count: 9, key_asset_ids: [] }],
    days: [],
  },
};

describe("suggestions", () => {
  it("matches named people, albums inside folders, and dates by word prefix", () => {
    expect(buildSuggestions(sources, "ann", []).map((s) => s.title)).toEqual(["Anna Smith", "Annecy 2023"]);
    expect(buildSuggestions(sources, "mar", []).map((s) => s.title)).toEqual(["March 2024"]);
    expect(buildSuggestions(sources, "2024", []).map((s) => s.title)).toEqual(["March 2024", "2024"]);
  });

  it("never suggests unnamed face groups or an empty query", () => {
    expect(buildSuggestions(sources, "person", [])).toEqual([]);
    expect(buildSuggestions(sources, "  ", [])).toEqual([]);
  });

  it("does not offer a suggestion that is already a token", () => {
    expect(buildSuggestions(sources, "anna", [{ kind: "person", label: "Anna Smith" }])).toEqual([]);
  });
});
