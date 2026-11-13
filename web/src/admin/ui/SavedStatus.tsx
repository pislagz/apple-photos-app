import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

const SAVED_VISIBLE_MS = 2000;

/** Small inline text next to a row that saved itself. Always in the DOM so screen readers announce changes. */
export default function SavedStatus({ state, message }: { state: SaveState; message?: string }) {
  let text = "";
  if (state === "saving") text = "Saving…";
  else if (state === "saved") text = "Saved";
  else if (state === "error") text = message ?? "Could not save. Try again.";
  return (
    <span role="status" aria-live="polite" className={`admin-saved admin-saved--${state}`}>
      {text}
    </span>
  );
}

/** Wrap an instant-save call: `run(() => api.write(...))`. "Saved" fades out by itself. */
export function useSaveStatus(): {
  state: SaveState;
  error: string | undefined;
  run: (save: () => Promise<unknown>) => Promise<boolean>;
} {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(async (save: () => Promise<unknown>) => {
    clearTimeout(timer.current);
    setError(undefined);
    setState("saving");
    try {
      await save();
    } catch (err) {
      setError(err instanceof Error && err.message !== "" ? err.message : undefined);
      setState("error");
      return false;
    }
    setState("saved");
    timer.current = setTimeout(() => setState("idle"), SAVED_VISIBLE_MS);
    return true;
  }, []);

  return { state, error, run };
}
