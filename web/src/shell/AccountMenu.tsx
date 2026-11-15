import { useState } from "react";
import { type MeResponse, removeAvatar } from "../api";
import Avatar from "./Avatar";
import AvatarPicker from "./AvatarPicker";
import ChangePasswordDialog from "./ChangePasswordDialog";
import InfoButton from "../help/InfoButton";
import { Icon } from "./icons";
import PasskeysDialog from "./PasskeysDialog";

function AccountMenuItems({
  me,
  onLogout,
  onPasswordDialogClosed,
  onAvatarChanged,
}: {
  me: MeResponse;
  onLogout: () => void;
  onPasswordDialogClosed?: () => void;
  onAvatarChanged?: () => void;
}) {
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  return (
    <>
      <div className="account-menu__identity">
        <button
          type="button"
          className="account-menu__avatar-button"
          aria-label="Choose avatar"
          disabled={me.libraries.length === 0}
          onClick={() => setChoosingAvatar(true)}
        >
          <Avatar username={me.username} version={me.avatar_version} className="account-menu__avatar account-menu__avatar--large" />
        </button>
        <p className="account-menu__username">{me.username}</p>
      </div>
      {me.role === "admin" && <a href="/admin">Admin</a>}
      {me.libraries.length > 0 && (
        <button type="button" onClick={() => setChoosingAvatar(true)}>
          Choose avatar…
        </button>
      )}
      {me.avatar_version != null && (
        <button type="button" onClick={() => removeAvatar().then(() => onAvatarChanged?.(), () => {})}>
          Remove avatar
        </button>
      )}
      <div className="account-menu__row">
        <button type="button" onClick={() => setChangingPassword(true)}>
          Change password
        </button>
        <InfoButton helpKey="changePassword" name="Change password" />
      </div>
      <div className="account-menu__row">
        <button type="button" onClick={() => setManagingPasskeys(true)}>
          Passkeys
        </button>
        <InfoButton helpKey="passkeys" name="Passkeys" />
      </div>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
      {choosingAvatar && (
        <AvatarPicker
          libraries={me.libraries}
          onClose={() => {
            setChoosingAvatar(false);
            onPasswordDialogClosed?.();
          }}
          onSaved={() => onAvatarChanged?.()}
        />
      )}
      {changingPassword && (
        <ChangePasswordDialog
          onClose={() => {
            setChangingPassword(false);
            onPasswordDialogClosed?.();
          }}
        />
      )}
      {managingPasskeys && <PasskeysDialog onClose={() => setManagingPasskeys(false)} />}
    </>
  );
}

// The desktop sidebar uses MacAccountMenu (#292).
// Mobile (iOS large-title header): the same controls behind a round "..."
// trigger, like the overflow button in ios17-library-days.png, so they
// don't eat a row of the overlaid title.
export default function AccountMenu({
  me,
  onLogout,
  onAvatarChanged,
  compact = false,
}: {
  me: MeResponse;
  onLogout: () => void;
  onAvatarChanged?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!compact) {
    return (
      <div className="account-menu">
        <AccountMenuItems
          me={me}
          onLogout={onLogout}
          onAvatarChanged={onAvatarChanged}
        />
      </div>
    );
  }

  return (
    <div className="account-menu account-menu--compact">
      <button
        type="button"
        className="account-menu__trigger"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" className="account-menu__trigger-icon" />
      </button>
      {open && (
        <div className="account-menu__popover">
          <AccountMenuItems
            me={me}
            onLogout={onLogout}
            onPasswordDialogClosed={() => setOpen(false)}
            onAvatarChanged={onAvatarChanged}
          />
        </div>
      )}
    </div>
  );
}
