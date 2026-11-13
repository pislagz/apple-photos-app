import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, assignLibrary, type LibraryResponse, unassignLibrary, type UserResponse } from "./api";
import Sheet from "./ui/Sheet";

export function describeError(err: unknown): string {
  return err instanceof ApiError && err.message !== "" ? err.message : "Something went wrong. Please try again.";
}

/** True on a phone-sized window. Starts false where matchMedia does not exist (tests). */
export function useIsPhone(): boolean {
  const query = "(max-width: 700px)";
  const [phone, setPhone] = useState(() => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setPhone(list.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, []);
  return phone;
}

export function switchLabel(user: UserResponse, library: LibraryResponse): string {
  return `${user.username} can see ${library.display_name}`;
}

/**
 * Turning a library on saves at once. Turning it off asks first, naming the person
 * and the library. `sheet` must be rendered by the caller.
 */
export function useAccessToggle(onChanged: () => void): {
  toggle: (user: UserResponse, library: LibraryResponse, assigned: boolean) => void;
  sheet: ReactNode;
  error: string | null;
  /** "<userId>:<libraryId>" of the switch that just saved. */
  savedKey: string | null;
  busyKey: string | null;
} {
  const [pending, setPending] = useState<{ user: UserResponse; library: LibraryResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = useCallback(
    async (user: UserResponse, library: LibraryResponse, assign: boolean) => {
      const key = `${user.id}:${library.id}`;
      setError(null);
      setBusyKey(key);
      try {
        await (assign ? assignLibrary(user.id, library.id) : unassignLibrary(user.id, library.id));
        setSavedKey(key);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setSavedKey(null), 2000);
        onChanged();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusyKey(null);
      }
    },
    [onChanged],
  );

  const toggle = useCallback(
    (user: UserResponse, library: LibraryResponse, assigned: boolean) => {
      if (assigned) setPending({ user, library });
      else void apply(user, library, true);
    },
    [apply],
  );

  const sheet = pending && (
    <Sheet
      title={`Stop sharing "${pending.library.display_name}" with ${pending.user.username}?`}
      onClose={() => setPending(null)}
      actions={[
        {
          label: "Stop Sharing",
          kind: "destructive",
          onClick: () => {
            const { user, library } = pending;
            setPending(null);
            void apply(user, library, false);
          },
        },
      ]}
    >
      <p>
        {pending.user.username} will no longer see {pending.library.display_name}. Its photos are not touched, and you can share
        it again any time.
      </p>
    </Sheet>
  );

  return { toggle, sheet, error, savedKey, busyKey };
}
