import { type ElementType, useEffect, useRef, useState } from "react";

// Matches the 150 ms in the #209 spec. Same value as `--motion-fast` once the
// motion tokens (#206, PR #242) land; kept local until then.
export const TITLE_FADE_MS = 150;

// Text that cross-fades when it changes instead of swapping. The outgoing text
// sits in `data-prev`, drawn by a pseudo-element, so `textContent` is always
// just the current text.
export default function DateTitle({
  text,
  className,
  testId,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  testId?: string;
  as?: ElementType;
}) {
  const [prev, setPrev] = useState("");
  const last = useRef(text);
  useEffect(() => {
    if (last.current === text) return;
    setPrev(last.current);
    last.current = text;
    const timer = setTimeout(() => setPrev(""), TITLE_FADE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <Tag className={className} data-testid={testId} data-prev={prev || undefined}>
      <span key={text} className="date-title__text">
        {text}
      </span>
    </Tag>
  );
}
