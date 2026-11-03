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
