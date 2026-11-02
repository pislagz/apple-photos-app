import type { MeResponse } from "../api";
import LayoutOverrideControl from "./LayoutOverrideControl";
import type { LayoutOverride } from "./useLayout";

export default function AccountMenu({
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
    <div className="account-menu">
      <p className="account-menu__username">{me.username}</p>
      {me.role === "admin" && <a href="/admin">Admin</a>}
      <LayoutOverrideControl override={layoutOverride} onChange={onLayoutOverrideChange} />
      <button type="button" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}
