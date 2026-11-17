import { type ReactNode, useState } from "react";

// iOS 27 Settings-style large title: the big title is the first thing in the
// scroll area and scrolls away with the content; once it is gone a small
// centred title fades in over a soft blur at the top (no solid bar).
const COLLAPSE_AT = 36;

export default function LargeTitleScreen({
  title,
  className = "mobile-screen",
  bodyClassName = "mobile-screen__body",
  outside,
  children,
}: {
  title: string;
  className?: string;
  bodyClassName?: string;
  outside?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`${className} large-title-screen`}>
      <div className="large-title-bar" data-collapsed={collapsed} aria-hidden="true">
        <span className="large-title-bar__title">{title}</span>
      </div>
      <div
        className={bodyClassName}
        data-testid="large-title-scroll"
        onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > COLLAPSE_AT)}
      >
        <h1 className="mobile-screen__title large-title-screen__title">{title}</h1>
        {children}
      </div>
      {outside}
    </div>
  );
}
