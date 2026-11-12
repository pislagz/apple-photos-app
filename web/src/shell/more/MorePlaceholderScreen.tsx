import { Icon } from "../icons";

// People, Places and media types when there is nothing to show them for yet:
// no library, the library is being updated, or an unknown media type (#263).
export default function MorePlaceholderScreen({
  title,
  message,
  onBack,
}: {
  title: string;
  message: string;
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
        <p className="empty-state">{message}</p>
      </div>
    </div>
  );
}
