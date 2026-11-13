import { forwardRef, useId, useMemo, useState, type KeyboardEvent } from "react";
import SearchField from "./SearchField";
import SuggestionList from "./SuggestionList";
import type { SearchModel, SearchRow } from "./useSearchModel";

// #225: the toolbar search field plus the popover under it. Typing lists
// suggestions (chosen ones become tokens in the field); an empty, focused
// field lists the recent searches. Enter runs the search now; Esc clears.
const DesktopSearch = forwardRef<
  HTMLInputElement,
  {
    model: SearchModel;
    // Runs a query in the content area right away (the shell otherwise
    // follows the field after a short pause).
    onRun: (query: string) => void;
  }
>(function DesktopSearch({ model, onRun }, ref) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const typing = model.text.trim() !== "";

  const rows = useMemo<SearchRow[]>(
    () =>
      typing
        ? model.rows
        : model.recents.map((q) => ({ key: `recent:${q}`, kind: "text" as const, title: q, detail: "" })),
    [typing, model.rows, model.recents],
  );
  const open = focused && !dismissed && rows.length > 0;

  function choose(row: SearchRow) {
    if (typing) onRun(model.pick(row));
    else {
      model.runRecent(row.title);
      onRun(row.title);
    }
    setDismissed(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      model.clear();
      onRun("");
      event.currentTarget.blur();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!rows.length) return;
      event.preventDefault();
      setDismissed(false);
      const step = event.key === "ArrowDown" ? 1 : -1;
      model.setActive(((model.active + step + rows.length + 1) % (rows.length + 1)) - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = model.active >= 0 ? rows[model.active] : undefined;
      if (row) choose(row);
      else {
        onRun(model.commit());
        setDismissed(true);
      }
    }
  }

  return (
    <div className="desktop-search">
      <SearchField
        ref={ref}
        variant="desktop"
        value={model.text}
        onChange={(value) => {
          model.touch();
          setDismissed(false);
          model.setText(value);
        }}
        tokens={model.tokens}
        onRemoveToken={model.removeToken}
        onClear={() => {
          model.clear();
          onRun("");
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          model.touch();
          setDismissed(false);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        listId={listId}
        expanded={open}
        activeId={model.active >= 0 ? `${listId}-${model.active}` : undefined}
      />
      {open && (
        <div className="search-popover">
          {!typing && (
            <div className="search-popover__head">
              <span>Recent Searches</span>
              <button
                type="button"
                className="search-section__action"
                onMouseDown={(event) => event.preventDefault()}
                onClick={model.clearRecents}
              >
                Clear
              </button>
            </div>
          )}
          <SuggestionList id={listId} rows={rows} activeIndex={model.active} onHover={model.setActive} onPick={choose} />
        </div>
      )}
    </div>
  );
});

export default DesktopSearch;
