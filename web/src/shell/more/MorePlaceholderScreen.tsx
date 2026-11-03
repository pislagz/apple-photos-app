import { Icon } from "../icons";

// People, Places, and each media type have a real route (#125) before
// Phase 2 gives them real data (docs/TASKS.md P2.1-P2.4) -- this is the
// shared "frame matches the reference, no data yet" screen for all of them.
export default function MorePlaceholderScreen({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={onBack}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          More
        </button>
        <h1 className="mobile-screen__title">{title}</h1>
      </header>
      <div className="mobile-screen__body">
        <p>{title} lands in a later phase.</p>
      </div>
    </div>
  );
}
