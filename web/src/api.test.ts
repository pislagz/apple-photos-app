import { afterEach, describe, expect, it, vi } from "vitest";
import { getAssets } from "./api";
import { mockFetch } from "./testHelpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastParams(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  const url = String(fetchMock.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(url.split("?")[1]);
}

describe("getAssets filter", () => {
  it.each([
    ["all", {}],
    ["favorites", { favorite: "true" }],
    ["photos", { type: "photo" }],
    ["videos", { type: "video" }],
  ] as const)("maps %s to query params", async (filter, expected) => {
    const fetchMock = mockFetch(() => ({ items: [], next_cursor: null }));
    await getAssets(1, "cur", 50, null, filter);
    const params = lastParams(fetchMock);
    expect(params.get("cursor")).toBe("cur");
    expect(params.get("favorite")).toBe((expected as { favorite?: string }).favorite ?? null);
    expect(params.get("type")).toBe((expected as { type?: string }).type ?? null);
  });
});
