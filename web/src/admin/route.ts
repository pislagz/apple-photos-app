import { useCallback, useEffect, useState } from "react";
import { MAP_PLACE_NAMES_ANCHOR } from "../shell/PlaceInfoContext";

export type Section =
  "libraries" | "people" | "sharing" | "devices" | "activity" | "settings";

export const SECTIONS: Section[] = [
  "libraries",
  "people",
  "sharing",
  "devices",
  "activity",
  "settings",
];

export type Route = { section: Section; id: string | null };

// Hashes from before the sections were renamed (#316).
const OLD_NAMES: Record<string, Section> = {
  users: "people",
  access: "sharing",
  sessions: "devices",
  audit: "activity",
  "audit-log": "activity",
};

/** Turns a location hash into a route. Unknown hashes fall back to Libraries. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (raw === MAP_PLACE_NAMES_ANCHOR) return { section: "settings", id: null };
  const [head = "", ...rest] = raw.split("/");
  const section = (SECTIONS as string[]).includes(head)
    ? (head as Section)
    : OLD_NAMES[head];
  if (section === undefined) return { section: "libraries", id: null };
  let id: string | null = rest.join("/") || null;
  if (id !== null) {
    try {
      id = decodeURIComponent(id);
    } catch {
      id = null;
    }
  }
  // Only Libraries and People have detail pages.
  if (section !== "libraries" && section !== "people") id = null;
  return { section, id };
}

export function routeHash(route: Route): string {
  return route.id === null
    ? `#${route.section}`
    : `#${route.section}/${encodeURIComponent(route.id)}`;
}

/** The hash a given location hash should be rewritten to, or null when it is already the new form. */
export function redirectFor(hash: string): string | null {
  if (hash === "" || hash === "#") return null;
  if (hash === `#${MAP_PLACE_NAMES_ANCHOR}`) return null;
  const canonical = routeHash(parseHash(hash));
  return canonical === hash ? null : canonical;
}

/** Hash routing without a router library. Detail pages push history entries, so the browser's Back works. */
export function useAdminRoute() {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash),
  );
  // "forward" when going into a detail page, "back" when leaving one; drives the phone slide.
  const [direction, setDirection] = useState<"forward" | "back" | null>(null);

  useEffect(() => {
    const target = redirectFor(window.location.hash);
    if (target !== null) window.history.replaceState(null, "", target);
    const sync = () => {
      const redirect = redirectFor(window.location.hash);
      if (redirect !== null) window.history.replaceState(null, "", redirect);
      const next = parseHash(window.location.hash);
      setRoute((prev) => {
        const wasDetail = prev.id !== null;
        const isDetail = next.id !== null;
        setDirection(
          isDetail && !wasDetail
            ? "forward"
            : !isDetail && wasDetail
              ? "back"
              : null,
        );
        return prev.section === next.section && prev.id === next.id
          ? prev
          : next;
      });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((section: Section, id: string | null = null) => {
    window.location.hash = routeHash({ section, id });
  }, []);

  return { route, direction, navigate };
}
