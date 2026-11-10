import { forwardRef } from "react";
import { Icon } from "../icons";

// P2.4: the search box on both layouts (a controlled input: the owner
// debounces and decides what a query does).
const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    variant: "desktop" | "mobile";
    autoFocus?: boolean;
  }
>(function SearchField({ value, onChange, variant, autoFocus }, ref) {
  return (
    <div className={`search-box search-box--${variant}`} role="search">
      <Icon name="search" className="search-box__icon" />
      <input
        ref={ref}
        type="search"
        className="search-box__input"
        placeholder="Search"
        aria-label="Search photos"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" className="search-box__clear" aria-label="Clear search" onClick={() => onChange("")}>
          ×
        </button>
      )}
    </div>
  );
});

export default SearchField;
