import { useState } from "react";
import type { MeResponse } from "../api";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { Icon } from "./icons";
import PasskeysDialog from "./PasskeysDialog";
import LayoutOverrideControl from "./LayoutOverrideControl";
import type { LayoutOverride } from "./useLayout";

function AccountMenuItems({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  onPasswordDialogClosed,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  onPasswordDialogClosed?: () => void;
}) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  return (
    <>
      <p className="account-menu__username">{me.username}</p>
      {me.role === "admin" && <a href="/admin">Admin</a>}
      <LayoutOverrideControl override={layoutOverride} onChange={onLayoutOverrideChange} />
      <button type="button" onClick={() => setChangingPassword(true)}>
        Change password
      </button>
      <button type="button" onClick={() => setManagingPasskeys(true)}>
        Passkeys
      </button>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
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

// Desktop (Sequoia sidebar footer): a tidy row -- avatar glyph, username,
// a disclosure chevron -- that opens the same popover upward into the
// sidebar, instead of the plain stack of controls it used to be.
// Mobile (iOS large-title header): the same controls behind a round "..."
// trigger, like the overflow button in ios17-library-days.png, so they
// don't eat a row of the overlaid title.
export default function AccountMenu({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  compact = false,
  variant = "overlay",
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  compact?: boolean;
  variant?: "overlay" | "row";
}) {
  const [open, setOpen] = useState(false);

  if (!compact) {
    return (
      <div className="account-menu">
        <AccountMenuItems
          me={me}
          layoutOverride={layoutOverride}
          onLayoutOverrideChange={onLayoutOverrideChange}
          onLogout={onLogout}
        />
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className="account-menu account-menu--row">
        <button
          type="button"
          className="account-menu__row-trigger"
          aria-label="Account menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="account-menu__avatar" aria-hidden="true">
            {me.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-menu__row-username">{me.username}</span>
          <Icon name="chevron" size={14} className="account-menu__row-chevron" />
        </button>
        {open && (
          <div className="account-menu__popover account-menu__popover--row">
            <AccountMenuItems
              me={me}
              layoutOverride={layoutOverride}
              onLayoutOverrideChange={onLayoutOverrideChange}
              onLogout={onLogout}
              onPasswordDialogClosed={() => setOpen(false)}
            />
          </div>
        )}
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
            layoutOverride={layoutOverride}
            onLayoutOverrideChange={onLayoutOverrideChange}
            onLogout={onLogout}
            onPasswordDialogClosed={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
