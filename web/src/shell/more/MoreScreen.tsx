import { useState } from "react";
import { type LibrarySummary, type MeResponse, removeAvatar } from "../../api";
import AvatarPicker from "../AvatarPicker";
import ChangePasswordDialog from "../ChangePasswordDialog";
import PasskeysDialog from "../PasskeysDialog";
import { Icon } from "../icons";
import LargeTitleScreen from "../LargeTitleScreen";
import LibrarySwitcher from "../LibrarySwitcher";
import { PHOTO_FORMAT_FOOTER_IPHONE, PHOTO_FORMAT_LABEL, TRANSFER_FORMAT_OPTIONS, useTransferFormat } from "../export/transferFormat";
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
  onLogout,
  onAvatarChanged,
}: {
  libraries: LibrarySummary[];
  activeLibraryId: number | undefined;
  onActiveLibraryChange: (id: number) => void;
  onNavigate: (path: "/people" | "/places" | `/media/${string}` | "/hidden") => void;
  me: MeResponse;
  onLogout: () => void;
  onAvatarChanged?: () => void;
}) {
  const utilities = libraries.find((l) => l.id === activeLibraryId)?.utilities ?? { enabled: false, imports: false, hidden: false };
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [transferFormat, setTransferFormat] = useTransferFormat();
  return (
    <LargeTitleScreen
      title="More"
      className="more-screen"
      bodyClassName="more-screen__body"
      outside={
        <>
          {choosingAvatar && (
            <AvatarPicker
              libraries={me.libraries}
              onClose={() => setChoosingAvatar(false)}
              onSaved={() => onAvatarChanged?.()}
            />
          )}
          {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
          {managingPasskeys && <PasskeysDialog onClose={() => setManagingPasskeys(false)} />}
        </>
      }
    >
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
        {/* #518: the admin picks per library which Utilities items exist. */}
        {(utilities.hidden || utilities.imports) && (
          <ul className="more-screen__group" aria-label="Utilities">
            <li className="more-screen__group-label">Utilities</li>
            {utilities.imports && (
              <li>
                <button type="button" className="more-screen__item" disabled>
                  <Icon name="tray" className="more-screen__icon" />
                  Imports
                </button>
              </li>
            )}
            {utilities.hidden && (
              <li>
                <button type="button" className="more-screen__item" onClick={() => onNavigate("/hidden")}>
                  <Icon name="hidden" className="more-screen__icon" />
                  Hidden
                </button>
              </li>
            )}
          </ul>
        )}
        {/* #507: one format for everything that leaves the app, Apple's wording. */}
        <ul className="more-screen__group" role="radiogroup" aria-label={PHOTO_FORMAT_LABEL}>
          <li className="more-screen__group-label">{PHOTO_FORMAT_LABEL}</li>
          {TRANSFER_FORMAT_OPTIONS.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="radio"
                aria-checked={option.value === transferFormat}
                className="more-screen__item more-screen__item--choice"
                onClick={() => setTransferFormat(option.value)}
              >
                <span>{option.label}</span>
                {option.value === transferFormat && (
                  <svg className="more-screen__check" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                    <path d="M4.5 10.5 8.5 14.5 15.5 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
        <p className="more-screen__switch-note">
          {PHOTO_FORMAT_FOOTER_IPHONE}
        </p>
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
        {me.role === "admin" && (
          <ul className="more-screen__group">
            <li className="more-screen__group-label">Settings</li>
            <li>
              <a href="/admin" className="more-screen__item more-screen__item--link">
                Admin
              </a>
            </li>
          </ul>
        )}
        <LibrarySwitcher
          libraries={libraries}
          activeLibraryId={activeLibraryId}
          onChange={onActiveLibraryChange}
          className="more-screen__library-switcher"
        />
    </LargeTitleScreen>
  );
}
