import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../api";
import { describeActivity, isKnownAction, KNOWN_ACTIONS } from "./activity";

const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 1,
  occurred_at: "2026-11-12 10:00:00",
  action: "login",
  actor: "pp",
  user_id: null,
  username: null,
  library_id: null,
  library_display_name: null,
  asset_id: null,
  detail: null,
  ...over,
});

// Reads the server's own source, so a new action code added there without a sentence fails here.
function serverActionCodes(): string[] {
  const dir = join(__dirname, "../../../../server/photos_viewer");
  const codes = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".py"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const m of text.matchAll(/write_audit_log\(\s*(?:\w+,\s*)?"([\w.]+)"/g)) codes.add(m[1]);
    for (const m of text.matchAll(/"(osm_consent_\w+)"/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe("describeActivity", () => {
  it("finds the codes the server writes", () => {
    const codes = serverActionCodes();
    expect(codes.length).toBeGreaterThan(25);
    expect(codes).toContain("revoke_session");
    expect(codes).toContain("prewarm.auto_restart");
  });

  it("maps every action code the server writes to a sentence", () => {
    for (const code of serverActionCodes()) {
      expect(isKnownAction(code), `no sentence for "${code}"`).toBe(true);
      const line = describeActivity(entry({ action: code, username: "Anna", library_display_name: "Family" }));
      expect(line.known).toBe(true);
      expect(line.sentence).not.toMatch(/[_.]/);
      expect(line.sentence).not.toMatch(/undefined|null|\[object/);
    }
    expect(KNOWN_ACTIONS.length).toBeGreaterThan(25);
  });

  it("words a few of them as people would", () => {
    expect(describeActivity(entry({ action: "add_library", library_display_name: "Family" })).sentence).toBe(
      "pp added the library Family",
    );
    expect(describeActivity(entry({ action: "revoke_session", username: "Anna" })).sentence).toBe("pp signed Anna out of a device");
    expect(describeActivity(entry({ action: "download", actor: null, username: "Anna", library_display_name: "Family" })).sentence).toBe(
      "Anna downloaded a photo from Family",
    );
    expect(describeActivity(entry({ action: "unlock_user", actor: "cli", username: "Anna" })).sentence).toBe(
      "An administrator at the server unlocked Anna's account",
    );
  });

  it("falls back safely for unknown, empty and odd codes", () => {
    const a = describeActivity(entry({ action: "future.thing_happened" }));
    expect(a).toMatchObject({ known: false, kind: "other" });
    expect(a.sentence).toBe("pp: future thing happened");
    expect(describeActivity(entry({ action: "" })).sentence).toBe("Something happened");
    expect(describeActivity(entry({ action: "constructor", actor: null })).known).toBe(false);
    expect(describeActivity(entry({ action: "toString" })).known).toBe(false);
    expect(() => describeActivity(entry({ action: undefined as unknown as string }))).not.toThrow();
  });
});
