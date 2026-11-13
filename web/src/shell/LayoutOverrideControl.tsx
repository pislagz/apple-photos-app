import { useId } from "react";
import InfoButton from "../help/InfoButton";
import type { LayoutOverride } from "./useLayout";

const OPTIONS: { value: LayoutOverride; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "mobile", label: "Mobile" },
  { value: "desktop", label: "Desktop" },
];

export default function LayoutOverrideControl({
  override,
  onChange,
}: {
  override: LayoutOverride;
  onChange: (value: LayoutOverride) => void;
}) {
  const id = useId();
  return (
    <div className="account-menu__row layout-override">
      <label htmlFor={id}>Layout</label>
      <InfoButton helpKey="layout" name="Layout" />
      <select id={id} value={override} onChange={(event) => onChange(event.target.value as LayoutOverride)}>
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
