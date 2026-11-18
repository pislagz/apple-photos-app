// Determinate ring, or a spinning quarter arc when the fraction is unknown.
// Drawn once and used by the iPhone HUD and the Mac toolbar buttons.
export default function ProgressRing({
  fraction,
  className = "progress-ring",
  label = "Progress",
}: {
  fraction: number | null;
  className?: string;
  label?: string;
}) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const known = fraction !== null;
  const value = known ? Math.max(0.02, Math.min(fraction, 1)) : 0.25;
  return (
    <svg
      className={`${className}${known ? "" : " is-indeterminate"}`}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(value * 100) : undefined}
    >
      <circle className="progress-ring__track" cx="12" cy="12" r={radius} />
      <circle
        className="progress-ring__value"
        cx="12"
        cy="12"
        r={radius}
        strokeDasharray={`${value * circumference} ${circumference}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
