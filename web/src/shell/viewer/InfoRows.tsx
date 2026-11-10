import type { InfoRow } from "./viewerInfo";

export function InfoRows({ rows, className }: { rows: InfoRow[]; className: string }) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label} className={`${className}__row`}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Optimize Mac Storage: only Apple's smaller derivative is on disk. Said in
// the Info panel/sheet before the user downloads (the download itself still
// serves that copy and sets X-Photos-Original-Missing).
export const ORIGINAL_MISSING_TEXT = "Only a smaller copy is on this Mac — downloads won't be the original.";

export function OriginalMissingNote({ available, className }: { available: boolean | undefined; className: string }) {
  if (available !== false) return null;
  return (
    <p className={className} role="note" data-testid="original-missing-note">
      {ORIGINAL_MISSING_TEXT}
    </p>
  );
}
