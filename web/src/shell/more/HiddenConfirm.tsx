import { Icon } from "../icons";

// Apple re-asks before showing Hidden every time; the password re-ask
// (#130) is a later task, so this is just the confirm step the issue asks
// for -- entering `/hidden` always lands here first, not straight on the
// list of hidden assets.
export default function HiddenConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header">
        <button type="button" className="mobile-screen__back" onClick={onCancel}>
          <Icon name="chevron" className="mobile-screen__back-icon" />
          More
        </button>
      </header>
      <div className="hidden-confirm">
        <Icon name="hidden" size={36} className="hidden-confirm__icon" />
        <h1>Hidden</h1>
        <p>Photos you&rsquo;ve hidden are kept out of Library, Albums, and search.</p>
        <button type="button" className="hidden-confirm__continue" onClick={onConfirm}>
          View Hidden Photos
        </button>
      </div>
    </div>
  );
}
