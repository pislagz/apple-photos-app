/** A grey placeholder row shown while a list loads. Hidden from screen readers. */
export default function SkeletonRow({ size }: { size?: "compact" | "touch" }) {
  return (
    <div className="admin-row admin-skeleton" aria-hidden="true" data-size={size}>
      <span className="admin-skeleton__bar admin-skeleton__bar--label" />
      <span className="admin-skeleton__bar admin-skeleton__bar--value" />
    </div>
  );
}
