import { Icon } from "./icons";

// No library to show yet (#263): a Photos-like welcome instead of an empty
// grid. Admins get the way to add one; everyone else learns who can.
export default function WelcomeScreen({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="welcome" data-testid="welcome">
      <Icon name="library" size={56} className="welcome__icon" />
      <h2 className="welcome__title">Welcome to Photos</h2>
      {isAdmin ? (
        <>
          <p className="welcome__text">Add a photo library to start browsing your photos and videos here.</p>
          <a className="welcome__action" href="/admin">
            Add a Library
          </a>
          <p className="welcome__hint">Already added one? Give your account access to it under Admin → Access.</p>
        </>
      ) : (
        <p className="welcome__text">
          There are no photo libraries for you yet. Ask your admin to add one or give you access.
        </p>
      )}
    </div>
  );
}
