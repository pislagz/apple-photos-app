import { useState } from "react";
import type { MeResponse } from "../api";
import { Icon } from "./icons";
import LayoutOverrideControl from "./LayoutOverrideControl";
import type { LayoutOverride } from "./useLayout";

function AccountMenuItems({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
}) {
  return (
    <>
      <p className="account-menu__username">{me.username}</p>
      {me.role === "admin" && <a href="/admin">Admin</a>}
      <LayoutOverrideControl override={layoutOverride} onChange={onLayoutOverrideChange} />
      <button type="button" onClick={onLogout}>
        Log out
      </button>
    </>
  );
}

// Desktop (Sequoia sidebar footer): small grey controls stacked inline.
// Mobile (iOS large-title header): the same controls behind a round "..."
// trigger, like the overflow button in ios17-library-days.png, so they
// don't eat a row of the overlaid title.
export default function AccountMenu({
  me,
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  compact = false,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  compact?: boolean;
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
          />
        </div>
      )}
    </div>
  );
}
