import { useEffect, useState } from "react";
import { avatarUrl } from "../api";

// The user's picture, or their initial. A missing or unreadable picture falls
// back to the initial instead of a broken image (#256).
export default function Avatar({
  username,
  version,
  className = "account-menu__avatar",
}: {
  username: string;
  version?: number | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [version, username]);
  const showImage = version != null && !failed;
  return (
    <span className={className} aria-hidden="true" data-has-image={showImage ? "true" : undefined}>
      {showImage ? (
        <img className="account-menu__avatar-img" src={avatarUrl(username, version)} alt="" onError={() => setFailed(true)} />
      ) : (
        username.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
