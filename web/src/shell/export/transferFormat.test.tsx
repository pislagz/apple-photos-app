import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getTransferFormat, setTransferFormat, useTransferFormat } from "./transferFormat";

beforeEach(() => localStorage.clear());

describe("Transfer Format", () => {
  it("defaults to Automatic and remembers Keep Originals", () => {
    expect(getTransferFormat()).toBe("automatic");
    setTransferFormat("original");
    expect(getTransferFormat()).toBe("original");
    expect(localStorage.getItem("photos-viewer:transfer-format")).toBe("original");
  });

  it("ignores junk and drops the old Download as ZIP key", () => {
    localStorage.setItem("photos-viewer:transfer-format", "zip");
    localStorage.setItem("photos-viewer:download-as-zip", "1");
    expect(getTransferFormat()).toBe("automatic");
    expect(localStorage.getItem("photos-viewer:download-as-zip")).toBeNull();
  });

  it("the hook follows changes made elsewhere", () => {
    const { result } = renderHook(() => useTransferFormat());
    expect(result.current[0]).toBe("automatic");
    act(() => result.current[1]("original"));
    expect(result.current[0]).toBe("original");
  });
});
