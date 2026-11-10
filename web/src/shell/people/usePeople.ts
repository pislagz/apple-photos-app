import { useCallback, useEffect, useState } from "react";
import { getPeople, type Person } from "../../api";

export interface PeopleState {
  people: Person[] | null;
  // Set when `/people` fails, so the screen can say so and offer Retry.
  error: boolean;
  retry: () => void;
}

// P2.2: named people of one library, one call.
export function usePeople(libraryId: number): PeopleState {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPeople(null);
    setError(false);
    let cancelled = false;
    getPeople(libraryId)
      .then((response) => {
        if (!cancelled) setPeople(response.people);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { people, error, retry };
}
