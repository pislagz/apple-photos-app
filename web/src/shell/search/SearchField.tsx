import { forwardRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons";
import { COLLAPSE_AFTER, type SearchToken } from "./searchModel";

const TOKEN_ICON: Record<SearchToken["kind"], IconName> = {
  text: "search",
  person: "people",
  album: "albums",
  date: "days",
};

// #225: the search box on both layouts. Chosen suggestions sit inside it as
// token chips (each removable); Backspace on an empty field removes the
// last one. Controlled: the owner debounces and decides what a query does.
const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    variant: "desktop" | "mobile";
    autoFocus?: boolean;
    tokens?: SearchToken[];
    onRemoveToken?: (index: number) => void;
    onClear?: () => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    // Combobox wiring for the suggestion list.
    listId?: string;
    expanded?: boolean;
    activeId?: string;
  }
>(function SearchField(
  { value, onChange, variant, autoFocus, tokens = [], onRemoveToken, onClear, onKeyDown, onFocus, onBlur, listId, expanded, activeId },
  ref,
) {
  const collapsed = tokens.length > COLLAPSE_AFTER;
  const hasContent = value !== "" || tokens.length > 0;
  return (
    <div className={`search-box search-box--${variant}${tokens.length ? " search-box--has-tokens" : ""}`} role="search">
      <Icon name="search" className="search-box__icon" />
      {tokens.length > 0 && (
        <ul className="search-box__tokens" aria-label="Search filters">
          {tokens.map((token, index) => (
            <li key={`${token.kind}:${token.label}`} className="token">
              <Icon name={TOKEN_ICON[token.kind]} className="token__icon" />
              {!collapsed && <span className="token__text">{token.label}</span>}
              <button
                type="button"
                className="token__remove"
                aria-label={`Remove ${token.label}`}
                title={collapsed ? token.label : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRemoveToken?.(index)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={ref}
        type="search"
        className="search-box__input"
        placeholder={tokens.length ? "" : "Search"}
        aria-label="Search photos"
        aria-autocomplete="list"
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded ? activeId : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && value === "" && tokens.length > 0) {
            event.preventDefault();
            onRemoveToken?.(tokens.length - 1);
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {hasContent && (
        <button
          type="button"
          className="search-box__clear"
          aria-label="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (onClear ? onClear() : onChange(""))}
        >
          <Icon name="close" />
        </button>
      )}
    </div>
  );
});

export default SearchField;
