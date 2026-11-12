// #263: the empty grid, centred like Photos. `isAdmin` is only passed for the
// whole-library case, where an admin may need to go and add content.
export default function LibraryEmptyState({
  title,
  text,
  adminLink,
}: {
  title: string;
  text?: string;
  adminLink?: boolean;
}) {
  return (
    <div className="library-empty" data-testid="library-empty">
      <svg
        className="library-empty__icon"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="14" y="6" width="42" height="34" rx="6" opacity="0.55" />
        <rect x="6" y="16" width="44" height="40" rx="6" />
        <circle cx="19" cy="29" r="4" />
        <path d="M8 50l13-12 9 8 8-7 12 11" />
      </svg>
      <h2 className="library-empty__title">{title}</h2>
      {text && <p className="library-empty__text">{text}</p>}
      {adminLink && (
        <a className="library-empty__link" href="/admin">
          Go to Admin → Libraries
        </a>
      )}
    </div>
  );
}
