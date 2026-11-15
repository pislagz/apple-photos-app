import { useId, useState } from "react";
import { SEARCH_PREFIX } from "../../api";
import { Icon } from "../icons";
import MobileLibrary from "../library/MobileLibrary";
import { FaceCircle } from "../people/PeopleGrid";
import SearchField from "./SearchField";
import SuggestionList from "./SuggestionList";
import { useSearchModel } from "./useSearchModel";

// P2.4 / #225: the phone Search tab. `/search` is the empty page (recent
// searches, people), `/search/<query>` is a results page (deep link reload
// works). Typing shows suggestions; Search / a tapped row runs the query and
// the route follows. Results are the ordinary All Photos grid and Viewer;
// loading, empty and error + Retry come from it.
export default function SearchScreen({
  libraryId,
  query,
  onQueryChange,
}: {
  libraryId: number;
  query: string;
  // Replaces the current history entry, so typing does not pile up history.
  onQueryChange: (query: string) => void;
}) {
  const model = useSearchModel(libraryId, query);
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const suggesting = focused && model.rows.length > 0;
  const people = model.sources.people.filter((p) => p.name).slice(0, 12);

  function run(q: string) {
    setFocused(false);
    onQueryChange(q);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!model.rows.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      model.setActive((model.active + step + model.rows.length + 1) % (model.rows.length + 1) - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = model.active >= 0 ? model.rows[model.active] : undefined;
      run(row ? model.pick(row) : model.commit());
      if (!row) event.currentTarget.blur();
    }
  }

  return (
    <div className="mobile-screen search-screen">
      <header className="mobile-screen__header mobile-screen__header--root search-screen__header">
        <h1 className="mobile-screen__title search-screen__title">Search</h1>
        <SearchField
          variant="mobile"
          value={model.text}
          onChange={(value) => {
            model.touch();
            model.setText(value);
            // Emptying the field by hand leaves the old results behind.
            if (value === "" && model.tokens.length === 0 && query) run("");
          }}
          tokens={model.tokens}
          onRemoveToken={(index) => {
            const q = model.tokens.filter((_, i) => i !== index).map((t) => t.label).concat(model.text.trim()).join(" ").trim();
            model.removeToken(index);
            if (query) run(q);
          }}
          onClear={() => {
            model.clear();
            run("");
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            model.touch();
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          autoFocus={!query}
          listId={listId}
          expanded={suggesting}
          activeId={model.active >= 0 ? `${listId}-${model.active}` : undefined}
        />
      </header>
      {suggesting ? (
        <div className="mobile-screen__body search-screen__body">
          <SuggestionList
            id={listId}
            rows={model.rows}
            activeIndex={model.active}
            onHover={model.setActive}
            onPick={(row) => run(model.pick(row))}
          />
        </div>
      ) : query ? (
        <div className="mobile-screen__album-grid">
          <MobileLibrary key={query} libraryId={libraryId} album={`${SEARCH_PREFIX}${query}`} />
        </div>
      ) : (
        <div className="mobile-screen__body search-screen__body">
          {model.recents.length > 0 && (
            <section aria-labelledby={`${listId}-recents`} className="search-section">
              <div className="search-section__head">
                <h2 id={`${listId}-recents`} className="search-section__title">
                  Recent Searches
                </h2>
                <button type="button" className="search-section__action" onClick={model.clearRecents}>
                  Clear
                </button>
              </div>
              <ul className="recent-cards">
                {model.recents.map((recent) => (
                  <li key={recent}>
                    <button
                      type="button"
                      className="recent-card"
                      onClick={() => {
                        model.runRecent(recent);
                        run(recent);
                      }}
                    >
                      <Icon name="search" className="recent-card__icon" />
                      <span className="recent-card__title">{recent}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {people.length > 0 && (
            <section aria-labelledby={`${listId}-people`} className="search-section">
              <h2 id={`${listId}-people`} className="search-section__title">
                People
              </h2>
              <ul className="people-row">
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="people-row__item"
                      onClick={() => run(model.pick({ key: `person:${person.id}`, kind: "person", title: person.name ?? person.label, detail: "Person", person }))}
                    >
                      <FaceCircle libraryId={libraryId} cover={person.cover} />
                      <span className="people-row__name">{person.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="search-screen__hint">
            Search by place, person, album, date, camera, or what is in the photo, like “beach” or “dog”.
          </p>
        </div>
      )}
    </div>
  );
}
