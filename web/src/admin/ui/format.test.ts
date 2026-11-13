import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatWhen } from "./format";

const NOW = new Date("2026-11-13T12:00:00Z");
const when = (v: string | number | Date | null) => formatWhen(v, { now: NOW, timeZone: "UTC" });

describe("formatWhen", () => {
  it("says just now for the last moments, past or future", () => {
    expect(when("2026-11-13T11:59:50Z")).toBe("just now");
    expect(when("2026-11-13T12:00:20Z")).toBe("just now");
    expect(when(NOW)).toBe("just now");
  });

  it("uses singular and plural in the past", () => {
    expect(when("2026-11-13T11:59:00Z")).toBe("1 minute ago");
    expect(when("2026-11-13T11:55:00Z")).toBe("5 minutes ago");
    expect(when("2026-11-13T11:00:00Z")).toBe("1 hour ago");
    expect(when("2026-11-13T07:00:00Z")).toBe("5 hours ago");
    expect(when("2026-11-12T12:00:00Z")).toBe("1 day ago");
    expect(when("2026-11-10T12:00:00Z")).toBe("3 days ago");
  });

  it("uses 'in ...' for the future", () => {
    expect(when("2026-11-13T12:01:00Z")).toBe("in 1 minute");
    expect(when("2026-11-13T14:00:00Z")).toBe("in 2 hours");
    expect(when("2026-11-14T12:00:00Z")).toBe("in 1 day");
  });

  it("reads a timestamp without a zone as UTC", () => {
    expect(when("2026-11-13 11:55:00")).toBe("5 minutes ago");
    expect(when("2026-11-13T11:55:00")).toBe("5 minutes ago");
    expect(when("2026-11-13T13:55:00+02:00")).toBe("5 minutes ago");
  });

  it("shows a date after a week, with the year only when it differs", () => {
    expect(when("2026-11-05T12:00:00Z")).toBe("Nov 5");
    expect(when("2025-03-01T12:00:00Z")).toBe("Mar 1, 2025");
    expect(when("2026-01-01")).toBe("Jan 1");
    expect(when(0)).toBe("Jan 1, 1970");
  });

  it("handles missing and broken values", () => {
    expect(when(null)).toBe("Never");
    expect(when("")).toBe("Never");
    expect(when("not a date")).toBe("Unknown");
  });
});

describe("formatBytes", () => {
  it("handles 0 and 1 byte", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(999)).toBe("999 bytes");
  });

  it("scales with decimal units", () => {
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(12_400_000)).toBe("12 MB");
    expect(formatBytes(3_200_000_000)).toBe("3.2 GB");
    expect(formatBytes(2_000_000_000_000)).toBe("2 TB");
  });

  it("does not show 1000 of a unit", () => {
    expect(formatBytes(999_999)).toBe("1 MB");
  });

  it("copes with huge and invalid values", () => {
    expect(formatBytes(Number.MAX_SAFE_INTEGER)).toBe("9.0 PB".replace(".0", ""));
    expect(formatBytes(1e30)).toMatch(/ EB$/);
    expect(formatBytes(-1)).toBe("Unknown size");
    expect(formatBytes(Number.NaN)).toBe("Unknown size");
    expect(formatBytes(null)).toBe("Unknown size");
  });
});

describe("formatDuration", () => {
  it("handles 0 and singular/plural", () => {
    expect(formatDuration(0)).toBe("0 seconds");
    expect(formatDuration(0.9)).toBe("0 seconds");
    expect(formatDuration(1)).toBe("1 second");
    expect(formatDuration(45)).toBe("45 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(125)).toBe("2 minutes, 5 seconds");
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(3660)).toBe("1 hour, 1 minute");
    expect(formatDuration(90_000)).toBe("1 day, 1 hour");
  });

  it("keeps two units at most and skips empty ones", () => {
    expect(formatDuration(86_400 + 3600 + 60 + 1)).toBe("1 day, 1 hour");
    expect(formatDuration(86_400 + 5)).toBe("1 day");
  });

  it("copes with huge and invalid values", () => {
    expect(formatDuration(1_000_000_000)).toBe("11574 days, 1 hour");
    expect(formatDuration(-5)).toBe("Unknown");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("Unknown");
    expect(formatDuration(undefined)).toBe("Unknown");
  });
});
