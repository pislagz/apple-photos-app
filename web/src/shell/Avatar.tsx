import { useEffect, useState } from "react";
import { avatarUrl } from "../api";

// The user's picture, or their initial. A missing or unreadable picture falls
// back to the initial instead of a broken image (#256).
export default function Avatar({
  username,
  version,
  className = "account-menu__avatar",
  src,
}: {
  username: string;
  version?: number | null;
  className?: string;
  // #519: the public profile picture URL, for the sign-in screen (no session yet).
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [version, username, src]);
  const showImage = (src != null || version != null) && !failed;
  return (
    <span className={className} aria-hidden="true" data-has-image={showImage ? "true" : undefined}>
      {showImage ? (
        <img className="account-menu__avatar-img" src={src ?? avatarUrl(username, version as number)} alt="" onError={() => setFailed(true)} />
      ) : (
        username.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
