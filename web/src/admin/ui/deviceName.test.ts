import { describe, expect, it } from "vitest";
import { deviceName } from "./deviceName";

describe("deviceName", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Chrome/120.0 Safari/537.36", "Chrome on Mac"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120", "Edge on Windows PC"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko Firefox/120.0", "Firefox on Linux"],
    ["iPhone", "iPhone"],
    [null, "Unknown device"],
    ["", "Unknown device"],
    ["curl/8.0 (weird; thing)", "Unknown device"],
  ])("%s", (raw, expected) => {
    expect(deviceName(raw)).toBe(expected);
  });
});
