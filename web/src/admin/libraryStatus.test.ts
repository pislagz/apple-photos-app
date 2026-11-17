import { describe, expect, it } from "vitest";
import type { LibraryStatusResponse } from "./api";
import { statusKind, statusWord, warningText } from "./libraryStatus";

const READY = {
  id: 1,
  display_name: "Family",
  path: "/Volumes/Photos/Family.photoslibrary",
  asset_count: 20,
  video_count: 2,
  people_count: 3,
  total_size_bytes: 1,
  last_indexed_at: "2026-11-11 09:14:03",
  index_state: "idle",
  prewarm_progress: null,
  warnings: [],
} as unknown as LibraryStatusResponse;

function withWarning(code: string, extra: Partial<LibraryStatusResponse> = {}): LibraryStatusResponse {
  return { ...READY, ...extra, warnings: [{ code, message: `server says ${code}` }] } as LibraryStatusResponse;
}

describe("library status words (#461)", () => {
  it("does not call Photos writing to the library a missing drive", () => {
    for (const code of ["photos_busy", "library_open"]) {
      const status = withWarning(code);
      expect(statusKind(status)).toBe("busy");
      expect(statusWord(status)).toBe("Waiting for Photos");
      expect(warningText(status.warnings[0])).toMatch(/Photos on the Mac is updating this library/);
      expect(warningText(status.warnings[0])).not.toMatch(/drive/);
    }
  });

  it("names a lost permission instead of a missing drive", () => {
    const status = withWarning("no_permission");
    expect(statusWord(status)).toBe("No permission");
    expect(warningText(status.warnings[0])).toMatch(/Full Disk Access/);
  });

  it("treats only a really missing library as not found", () => {
    expect(statusKind(withWarning("drive_not_mounted"))).toBe("missing");
    expect(statusKind(withWarning("library_missing"))).toBe("missing");
    expect(statusKind(withWarning("volume_renamed"))).toBe("missing");
    expect(statusKind(withWarning("unreadable"))).toBe("attention");
    expect(statusKind(withWarning("drive_error"))).toBe("attention");
    expect(warningText(withWarning("unreadable").warnings[0])).not.toMatch(/connected/);
  });

  it("shows the server's text for a renamed volume, which names the new place", () => {
    const status = withWarning("volume_renamed");
    expect(warningText(status.warnings[0])).toBe("server says volume_renamed");
  });

  it("keeps a retried failure from looking like a first index", () => {
    const status = withWarning("temp_full", { last_indexed_at: null, index_state: "idle" });
    expect(statusKind(status)).toBe("attention");
  });
});
