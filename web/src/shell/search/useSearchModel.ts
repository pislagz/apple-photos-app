import { useCallback, useMemo, useState } from "react";
import {
  addRecent,
  buildQuery,
  buildSuggestions,
  loadRecents,
  saveRecents,
  type SearchToken,
  type Suggestion,
} from "./searchModel";
import { useSearchSources } from "./useSearchSources";

// One row above the suggestions that searches the words exactly as typed.
export type SearchRow = Suggestion | { key: "free"; kind: "text"; title: string; detail: string };

// #225: the state both layouts share: tokens + typed text, the suggestion
// rows for it, and the local recent searches. Nothing here talks to the
// server except the three read-only lists behind the suggestions.
export function useSearchModel(libraryId: number, initialText = "") {
  const [tokens, setTokens] = useState<SearchToken[]>([]);
  const [text, setTextRaw] = useState(initialText);
  // Row highlighted with the arrow keys; -1 means none (Enter runs the text).
  const [active, setActive] = useState(-1);
  const setText = useCallback((value: string) => {
    setTextRaw(value);
    setActive(-1);
  }, []);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [used, setUsed] = useState(false);
  const sources = useSearchSources(libraryId, used);

  const query = buildQuery(tokens, text);
  const rows = useMemo<SearchRow[]>(() => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [
      { key: "free", kind: "text", title: `Search for “${trimmed}”`, detail: "" },
      ...buildSuggestions(sources, trimmed, tokens),
    ];
  }, [sources, text, tokens]);

  const remember = useCallback((q: string) => {
    setRecents((current) => {
      const next = addRecent(current, q);
      saveRecents(next);
      return next;
    });
  }, []);

  // Call when the field is focused or typed in, so the lists load lazily.
  const touch = useCallback(() => setUsed(true), []);

  // Picking a suggestion turns it into a token; the free-text row just runs
  // the typed words. Returns the full query that is now being searched.
  const pick = useCallback(
    (row: SearchRow): string => {
      if (row.kind === "text") {
        const q = buildQuery(tokens, text);
        remember(q);
        return q;
      }
      const next = [...tokens, { kind: row.kind, label: row.title }];
      setTokens(next);
      setText("");
      const q = buildQuery(next, "");
      remember(q);
      return q;
    },
    [tokens, text, remember, setText],
  );

  const commit = useCallback(() => {
    const q = buildQuery(tokens, text);
    if (q) remember(q);
    return q;
  }, [tokens, text, remember]);

  const removeToken = useCallback((index: number) => setTokens((t) => t.filter((_, i) => i !== index)), []);
  const clear = useCallback(() => {
    setTokens([]);
    setText("");
  }, [setText]);
  const runRecent = useCallback(
    (q: string) => {
      setTokens([]);
      setText(q);
      remember(q);
    },
    [remember, setText],
  );
  const clearRecents = useCallback(() => {
    setRecents([]);
    saveRecents([]);
  }, []);

  return { tokens, text, setText, active, setActive, sources, query, rows, recents, touch, pick, commit, removeToken, clear, runRecent, clearRecents };
}

export type SearchModel = ReturnType<typeof useSearchModel>;
