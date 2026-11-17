import { afterEach, describe, expect, it, vi } from "vitest";
import { canPickDirectory, canShareFiles, detectExportCapabilities, isStandaloneApp } from "./capabilities";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capability detection", () => {
  it("share needs share() and a canShare() that accepts files", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
    expect(canShareFiles()).toBe(true);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
    expect(canShareFiles()).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn() });
    expect(canShareFiles()).toBe(false);
    vi.stubGlobal("navigator", { canShare: () => true });
    expect(canShareFiles()).toBe(false);
  });

  it("share is off in an insecure context and when canShare throws", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
    vi.stubGlobal("isSecureContext", false);
    expect(canShareFiles()).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: () => {
        throw new TypeError("nope");
      },
    });
    expect(canShareFiles()).toBe(false);
  });

  it("probes with a real File, not a bare canShare()", () => {
    const canShare = vi.fn(() => true);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare });
    canShareFiles();
    const arg = (canShare.mock.calls[0] as unknown[])[0] as { files: File[] };
    expect(arg.files[0]).toBeInstanceOf(File);
  });

  it("folder saving follows showDirectoryPicker", () => {
    expect(canPickDirectory()).toBe(false);
    vi.stubGlobal("showDirectoryPicker", vi.fn());
    expect(canPickDirectory()).toBe(true);
    vi.stubGlobal("isSecureContext", false);
    expect(canPickDirectory()).toBe(false);
  });

  it("standalone comes from display-mode or navigator.standalone", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("standalone") }));
    expect(isStandaloneApp()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isStandaloneApp()).toBe(false);
  });

  it("hides Download Individually in an installed app that can share", () => {
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(detectExportCapabilities()).toMatchObject({ share: true, standalone: true, individual: false });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(detectExportCapabilities()).toMatchObject({ share: true, individual: true });
  });

  it("never reads the user agent", () => {
    const ua = vi.fn(() => "iPhone");
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true, get userAgent() { return ua(); } });
    detectExportCapabilities();
    expect(ua).not.toHaveBeenCalled();
  });
});
