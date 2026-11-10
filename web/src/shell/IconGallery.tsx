import { ICON_NAMES, Icon } from "./icons";

// Every icon at 20 and 40 px, outline and filled. Used by the vitest and by
// the screenshot fixture in e2e/shots.e2e.ts; not routed in the app.
export default function IconGallery() {
  return (
    <div className="icon-gallery">
      {ICON_NAMES.map((name) => (
        <div key={name} className="icon-gallery__row" data-icon={name}>
          <span className="icon-gallery__name">{name}</span>
          <Icon name={name} size={20} />
          <Icon name={name} size={20} filled />
          <Icon name={name} size={40} />
          <Icon name={name} size={40} filled />
        </div>
      ))}
    </div>
  );
}
