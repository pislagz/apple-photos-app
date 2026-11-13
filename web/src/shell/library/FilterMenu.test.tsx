import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FilterMenu from "./FilterMenu";
import { DEFAULT_SHOW, hiddenKinds, type LibraryFilterState } from "./useLibraryFilter";

function makeState(over: Partial<LibraryFilterState> = {}): LibraryFilterState {
  return {
    filter: "all",
    show: DEFAULT_SHOW,
    hide: [],
    active: false,
    setFilter: vi.fn(),
    setShow: vi.fn(),
    ...over,
  };
}

describe("hiddenKinds", () => {
  it("hides nothing by default", () => {
    expect(hiddenKinds("all", DEFAULT_SHOW)).toEqual([]);
  });
  it("hides the kinds that are switched off", () => {
    expect(hiddenKinds("all", { screenshots: false, shared: false })).toEqual(["screenshots", "shared"]);
  });
  it("never hides the kind that is the chosen filter", () => {
    expect(hiddenKinds("screenshots", { screenshots: false, shared: true })).toEqual([]);
    expect(hiddenKinds("shared", { screenshots: true, shared: false })).toEqual([]);
  });
});

describe("FilterMenu desktop", () => {
  it("lists every filter, checks the current one and picks on click", () => {
    const state = makeState({ filter: "videos" });
    render(<FilterMenu state={state} variant="desktop" label="Filter By" />);
    fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent?.replace("✓", ""))).toEqual([
      "All Items", "Favorites", "Edited", "Photos", "Videos", "Screenshots", "Shared with You", "Not in an Album",
    ]);
    expect(screen.getByRole("menuitemradio", { name: /Videos/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Favorites/ }));
    expect(state.setFilter).toHaveBeenCalledWith("favorites");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles the Show items", () => {
    const state = makeState();
    render(<FilterMenu state={state} variant="desktop" label="Filter By" />);
    fireEvent.click(screen.getByRole("button", { name: "Filter By" }));
    const shot = screen.getByRole("menuitemcheckbox", { name: /Screenshots/ });
    expect(shot).toHaveAttribute("aria-checked", "true");
    fireEvent.click(shot);
    expect(state.setShow).toHaveBeenCalledWith("screenshots", false);
  });

  it("closes on Escape and moves with the arrow keys", () => {
    render(<FilterMenu state={makeState()} variant="desktop" label="Filter By" />);
    const button = screen.getByRole("button", { name: "Filter By" });
    fireEvent.click(button);
    const items = screen.getAllByRole("menuitemradio");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("marks the button active for a non-default filter", () => {
    render(<FilterMenu state={makeState({ active: true })} variant="desktop" label="Filter By" />);
    expect(screen.getByRole("button", { name: "Filter By" })).toHaveAttribute("data-active", "true");
  });
});

describe("FilterMenu mobile", () => {
  const viewOptions = {
    canZoomIn: true, canZoomOut: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), wholePhotos: false, onToggleWholePhotos: vi.fn(),
  };

  it("nests the filters under Filter and the zoom/aspect items under View Options", () => {
    const state = makeState();
    render(<FilterMenu state={state} variant="mobile" viewOptions={viewOptions} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Filter/ }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(8);
    fireEvent.click(screen.getByRole("menuitem", { name: /View Options/ }));
    expect(screen.getByRole("menuitem", { name: "Zoom Out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Zoom In" }));
    expect(viewOptions.onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Aspect Ratio Grid/ }));
    expect(viewOptions.onToggleWholePhotos).toHaveBeenCalled();
    expect(screen.getByRole("menuitemcheckbox", { name: /Shared with You/ })).toBeInTheDocument();
  });
});
