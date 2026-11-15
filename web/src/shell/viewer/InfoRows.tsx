import type { InfoRow } from "./viewerInfo";
import { PlaceNamesHint } from "./PlaceNamesHint";

export function InfoRows({ rows, className }: { rows: InfoRow[]; className: string }) {
  return (
    <dl className={className} data-selectable-text>
      {rows.map((row) => (
        <div key={row.label} className={`${className}__row`}>
          <dt>{row.label}</dt>
          <dd className={row.coordinatesOnly ? "info-row--hint" : undefined}>
            {row.value}
            {row.coordinatesOnly && <PlaceNamesHint />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Optimize Mac Storage: only Apple's smaller derivative is on disk. Said in
// the Info panel/sheet before the user downloads (the download itself still
// serves that copy and sets X-Photos-Original-Missing).
export const ORIGINAL_MISSING_TEXT = "Only a smaller copy is on this server — downloads won't be the original.";

// Referenced original: Photos recorded the file outside the library package
// and this server may only read inside it (or an admin-allowed root).
export const ORIGINAL_OUTSIDE_TEXT = "The original is stored outside the library and isn't available.";

export function OriginalOutsideNote({ outside, className }: { outside: boolean | undefined; className: string }) {
  if (!outside) return null;
  return (
    <p className={className} role="alert" data-testid="original-outside-note">
      {ORIGINAL_OUTSIDE_TEXT}
    </p>
  );
}

export function OriginalMissingNote({ available, className }: { available: boolean | undefined; className: string }) {
  if (available !== false) return null;
  return (
    <p className={className} role="note" data-testid="original-missing-note">
      {ORIGINAL_MISSING_TEXT}
    </p>
  );
}
