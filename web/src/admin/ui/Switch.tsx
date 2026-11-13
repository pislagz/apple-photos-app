// An on/off toggle that saves the moment it is flipped, like iPhone Settings.
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  variant = "ios",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Read out by screen readers; say what turns on, e.g. "Allow downloads". */
  label: string;
  disabled?: boolean;
  variant?: "ios" | "mac";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`admin-switch admin-switch--${variant}`}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-switch__knob" aria-hidden="true" />
    </button>
  );
}
