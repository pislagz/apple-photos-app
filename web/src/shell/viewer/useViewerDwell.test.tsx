import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetListItem } from "../../api";
import { ORIGINAL_DWELL_MS } from "./gestures";
import { useViewerMedia } from "./useViewerMedia";

const item = (id: string): AssetListItem => ({
  id,
  filename: `${id}.jpg`,
  date: "2024-05-10T10:00:00",
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 100,
  height: 100,
  duration: null,
});

function Probe({ id }: { id: string }) {
  const media = useViewerMedia(1, item(id), false);
  return <img alt="probe" src={media.wantsOriginal ? media.originalSrc : media.previewSrc} onLoad={media.onPreviewLoaded} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("original dwell (#214)", () => {
  it("requests the original only after the photo has been settled for 350 ms", () => {
    vi.useFakeTimers();
    render(<Probe id="a1" />);
    const img = screen.getByAltText("probe") as HTMLImageElement;
    fireEvent.load(img);
    act(() => void vi.advanceTimersByTime(ORIGINAL_DWELL_MS - 1));
    expect(img.src).toContain("size=preview");
    act(() => void vi.advanceTimersByTime(1));
    expect(img.src).toContain("/original/a1");
  });

  it("is skipped while paging fast: each page change restarts the clock", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe id="a1" />);
    const img = screen.getByAltText("probe") as HTMLImageElement;
    for (const id of ["a2", "a3", "a4", "a5"]) {
      fireEvent.load(img);
      act(() => void vi.advanceTimersByTime(ORIGINAL_DWELL_MS - 50));
      rerender(<Probe id={id} />);
      expect(img.src).not.toContain("/original/");
    }
    fireEvent.load(img);
    act(() => void vi.advanceTimersByTime(ORIGINAL_DWELL_MS));
    expect(img.src).toContain("/original/a5");
  });
});
