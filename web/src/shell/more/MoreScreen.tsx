import { useState } from "react";
import { type LibrarySummary, type MeResponse, removeAvatar } from "../../api";
import AvatarPicker from "../AvatarPicker";
import ChangePasswordDialog from "../ChangePasswordDialog";
import LayoutOverrideControl from "../LayoutOverrideControl";
import PasskeysDialog from "../PasskeysDialog";
import type { LayoutOverride } from "../useLayout";
import { Icon } from "../icons";
import LibrarySwitcher from "../LibrarySwitcher";
import { MEDIA_TYPES } from "./mediaTypes";

// #125, tracker R1: the phone "More" tab -- People & Pets, Places, Media
// Types, and Utilities (Hidden only; no Recently Deleted or Duplicates,
// this app is view-only). Tracker R21: the library switcher sits at the
// very bottom since switching libraries is rare -- same placement as the
// bottom of the Mac sidebar (#90).
export default function MoreScreen({
  libraries,
  activeLibraryId,
  onActiveLibraryChange,
  onNavigate,
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  onAvatarChanged,
}: {
  libraries: LibrarySummary[];
  activeLibraryId: number | undefined;
  onActiveLibraryChange: (id: number) => void;
  onNavigate: (path: "/people" | "/places" | `/media/${string}` | "/hidden") => void;
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  onAvatarChanged?: () => void;
}) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  return (
    <div className="more-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">More</h1>
      </header>
      <div className="more-screen__body">
        <ul className="more-screen__group">
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/people")}>
              <Icon name="people" className="more-screen__icon" />
              People & Pets
            </button>
          </li>
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/places")}>
              <Icon name="map" className="more-screen__icon" />
              Places
            </button>
          </li>
        </ul>
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Media Types</li>
          {MEDIA_TYPES.map((type) => (
            <li key={type.slug}>
              <button
                type="button"
                className="more-screen__item"
                onClick={() => onNavigate(`/media/${type.slug}`)}
              >
                <Icon name={type.icon} className="more-screen__icon" />
                {type.label}
              </button>
            </li>
          ))}
        </ul>
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Utilities</li>
          <li>
            <button type="button" className="more-screen__item" onClick={() => onNavigate("/hidden")}>
              <Icon name="hidden" className="more-screen__icon" />
              Hidden
            </button>
          </li>
        </ul>
        {/* #303: everything the old top-right "..." menu offered. */}
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Account</li>
          <li>
            <p className="more-screen__item more-screen__item--static">Signed in as {me.username}</p>
          </li>
          {me.libraries.length > 0 && (
            <li>
              <button type="button" className="more-screen__item" onClick={() => setChoosingAvatar(true)}>
                Choose avatar…
              </button>
            </li>
          )}
          {me.avatar_version != null && (
            <li>
              <button
                type="button"
                className="more-screen__item"
                onClick={() => removeAvatar().then(() => onAvatarChanged?.(), () => {})}
              >
                Remove avatar
              </button>
            </li>
          )}
          <li>
            <button type="button" className="more-screen__item" onClick={() => setChangingPassword(true)}>
              Change password
            </button>
          </li>
          <li>
            <button type="button" className="more-screen__item" onClick={() => setManagingPasskeys(true)}>
              Passkeys
            </button>
          </li>
          <li>
            <button type="button" className="more-screen__item more-screen__item--danger" onClick={onLogout}>
              Log out
            </button>
          </li>
        </ul>
        <ul className="more-screen__group">
          <li className="more-screen__group-label">Settings</li>
          <li>
            <div className="more-screen__item">
              <LayoutOverrideControl override={layoutOverride} onChange={onLayoutOverrideChange} />
            </div>
          </li>
          {me.role === "admin" && (
            <li>
              <a href="/admin" className="more-screen__item more-screen__item--link">
                Admin
              </a>
            </li>
          )}
        </ul>
      </div>
      {choosingAvatar && (
        <AvatarPicker
          libraries={me.libraries}
          onClose={() => setChoosingAvatar(false)}
          onSaved={() => onAvatarChanged?.()}
        />
      )}
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
      {managingPasskeys && <PasskeysDialog onClose={() => setManagingPasskeys(false)} />}
      <LibrarySwitcher
        libraries={libraries}
        activeLibraryId={activeLibraryId}
        onChange={onActiveLibraryChange}
        className="more-screen__library-switcher"
      />
    </div>
  );
}
