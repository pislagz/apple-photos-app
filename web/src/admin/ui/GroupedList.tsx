import type { ReactNode } from "react";

export type RowSize = "compact" | "touch";

/** A rounded card of rows, like a Settings group. `heading` sits above it. */
export function GroupedList({
  heading,
  footer,
  label,
  children,
}: {
  heading?: string;
  /** Names the list for screen readers when it has no heading. */
  label?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-group">
      {heading !== undefined && <h3 className="admin-group__heading">{heading}</h3>}
      <div className="admin-group__rows" role="list" aria-label={label}>
        {children}
      </div>
      {footer !== undefined && <Footer>{footer}</Footer>}
    </section>
  );
}

/** One row: label (and optional small text) on the left, value or control on the right. */
export function Row({
  label,
  info,
  detail,
  value,
  control,
  onClick,
  destructive = false,
  size,
}: {
  label: ReactNode;
  /** An (i) button shown right after the label text. */
  info?: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  /** A Switch, select or button. Not used together with `onClick`. */
  control?: ReactNode;
  /** Makes the whole row a button with a chevron. */
  onClick?: () => void;
  destructive?: boolean;
  /** Default: 32px on desktop, 44px on a phone. */
  size?: RowSize;
}) {
  const body = (
    <>
      <span className="admin-row__text">
        {info === undefined ? (
          <span className="admin-row__label">{label}</span>
        ) : (
          <span className="admin-row__heading">
            <span className="admin-row__label">{label}</span>
            {info}
          </span>
        )}
        {detail !== undefined && <span className="admin-row__detail">{detail}</span>}
      </span>
      {value !== undefined && <span className="admin-row__value">{value}</span>}
      {control !== undefined && <span className="admin-row__control">{control}</span>}
      {onClick !== undefined && (
        <span className="admin-row__chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  const className = `admin-row${destructive ? " admin-row--destructive" : ""}`;
  return onClick === undefined ? (
    <div role="listitem" className={className} data-size={size}>
      {body}
    </div>
  ) : (
    <div role="listitem" className="admin-row-item">
      <button type="button" className={`${className} admin-row--action`} data-size={size} onClick={onClick}>
        {body}
      </button>
    </div>
  );
}

/** Small explanatory text under a group. */
export function Footer({ children }: { children: ReactNode }) {
  return <p className="admin-group__footer">{children}</p>;
}
