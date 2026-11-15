import { Icon, type IconName } from "../icons";
import type { SearchRow } from "./useSearchModel";

const ICON: Record<SearchRow["kind"], IconName> = {
  text: "search",
  person: "people",
  album: "albums",
  date: "days",
};

// #225: suggestion rows, the same layout in the desktop popover and on the
// phone (46px rows: 18px icon in a 26px column, 18px title, 14px detail).
// The active row is driven from the search field (combobox keyboard model);
// `onMouseDown` is prevented so choosing a row never blurs the field.
export default function SuggestionList({
  id,
  rows,
  activeIndex,
  onPick,
  onHover,
}: {
  id: string;
  rows: SearchRow[];
  activeIndex: number;
  onPick: (row: SearchRow) => void;
  onHover?: (index: number) => void;
}) {
  return (
    <ul className="suggestions" id={id} role="listbox" aria-label="Suggestions">
      {rows.map((row, index) => (
        <li
          key={row.key}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className="suggestions__row"
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHover?.(index)}
          onClick={() => onPick(row)}
        >
          <span className="suggestions__icon">
            <Icon name={ICON[row.kind]} />
          </span>
          <span className="suggestions__title">{row.title}</span>
          {row.detail && <span className="suggestions__detail">{row.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
