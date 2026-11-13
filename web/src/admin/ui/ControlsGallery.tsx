import { useState } from "react";
import "../admin.css";
import { Footer, GroupedList, Row, type RowSize } from "./GroupedList";
import SavedStatus, { type SaveState } from "./SavedStatus";
import Sheet from "./Sheet";
import SkeletonRow from "./SkeletonRow";
import Switch from "./Switch";
import { formatBytes, formatDuration, formatWhen } from "./format";

// Dev-only page (`/admin/controls`, see main.tsx) that shows every shared admin
// control at both row heights, for the screenshot spec and design review.
function Section({ size }: { size: RowSize }) {
  const [on, setOn] = useState(true);
  const [saved, setSaved] = useState<SaveState>("saved");
  const [sheet, setSheet] = useState(false);
  const px = size === "compact" ? 32 : 44;
  return (
    <div data-testid={`gallery-${size}`}>
      <GroupedList heading={`Rows at ${px}px`} footer="Changes save as soon as you make them.">
        <Row size={size} label="Show hidden photos" control={<><SavedStatus state={saved} /><Switch checked={on} label="Show hidden photos" onChange={(v) => { setOn(v); setSaved("saved"); }} /></>} />
        <Row size={size} label="Mac-style switch" control={<Switch variant="mac" checked={!on} label="Mac-style switch" onChange={(v) => setOn(!v)} />} />
        <Row size={size} label="Disabled switch" control={<Switch checked disabled label="Disabled switch" onChange={() => {}} />} />
        <Row size={size} label="Last backup" detail="Checked every 15 minutes" value={`${formatWhen(new Date(Date.now() - 5 * 60_000))} · ${formatBytes(1_500_000_000)}`} />
        <Row size={size} label="Scan time" value={formatDuration(125)} />
        <Row size={size} label="Name" control={<input className="admin-input" aria-label="Name" defaultValue="Family" />} />
        <Row size={size} label="Open library" onClick={() => {}} />
        <Row size={size} label="Remove library" destructive onClick={() => setSheet(true)} />
        <SkeletonRow size={size} />
      </GroupedList>
      <GroupedList heading="Buttons">
        <div className="admin-gallery__buttons">
          <button type="button" className="admin-btn admin-btn--primary">Save</button>
          <button type="button" className="admin-btn">Cancel</button>
          <button type="button" className="admin-btn admin-btn--danger">Sign out</button>
          <button type="button" className="admin-btn" disabled>Disabled</button>
        </div>
      </GroupedList>
      <Footer>Sheet opens from "Remove library".</Footer>
      {sheet && (
        <Sheet
          title="Remove this library?"
          onClose={() => setSheet(false)}
          actions={[{ label: "Remove", kind: "destructive", onClick: () => setSheet(false) }]}
        >
          Its photos stay on the drive. People will no longer see it here.
        </Sheet>
      )}
    </div>
  );
}

export default function ControlsGallery() {
  return (
    <main className="admin-gallery">
      <h1>Admin controls</h1>
      <Section size="compact" />
      <Section size="touch" />
    </main>
  );
}
