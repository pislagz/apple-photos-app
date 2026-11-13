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
  const viewOptions = () => ({
    canZoomIn: true, canZoomOut: false, onZoomIn: vi.fn(), onZoomOut: vi.fn(), wholePhotos: false, onToggleWholePhotos: vi.fn(),
  });
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Filter" }));

  it("opens with two rows, Filter and View Options, and no sort options", () => {
    render(<FilterMenu state={makeState()} variant="mobile" viewOptions={viewOptions()} />);
    open();
    expect(screen.getAllByRole("menuitem").map((r) => r.textContent)).toEqual(["Filter", "View Options"]);
    expect(screen.queryByText(/sort/i)).toBeNull();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("expands Filter in place with a collapsing header and the active row ticked", () => {
    const state = makeState({ filter: "videos" });
    render(<FilterMenu state={state} variant="mobile" viewOptions={viewOptions()} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));
    expect(screen.getAllByRole("menuitemradio").map((r) => r.textContent)).toEqual([
      "All Items", "Favorites", "Edited", "Photos", "Videos", "Screenshots", "Shared with You", "Not in an Album",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Videos" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Videos" }).querySelector(".filter-menu__tick")).not.toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "All Items" }).querySelector(".filter-menu__tick")).toBeNull();
    // Header collapses the card back to the two rows.
    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "View Options" })).toBeInTheDocument();
  });

  it("picking a filter applies it and closes the menu", () => {
    const state = makeState();
    render(<FilterMenu state={state} variant="mobile" viewOptions={viewOptions()} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Favorites" }));
    expect(state.setFilter).toHaveBeenCalledWith("favorites");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("View Options has zoom, aspect ratio and the Show: toggles", () => {
    const view = viewOptions();
    const state = makeState({ show: { screenshots: true, shared: false } });
    render(<FilterMenu state={state} variant="mobile" viewOptions={view} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "View Options" }));
    expect(screen.getByRole("menuitem", { name: "Zoom Out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Zoom In" }));
    expect(view.onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Aspect Ratio Grid" }));
    expect(view.onToggleWholePhotos).toHaveBeenCalled();
    expect(screen.getByText("Show:")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Screenshots" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Shared with You" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Shared with You" }));
    expect(state.setShow).toHaveBeenCalledWith("shared", true);
  });

  it("opens on one tap and closes on the button, the backdrop or Escape, without double toggles", () => {
    render(<FilterMenu state={makeState()} variant="mobile" viewOptions={viewOptions()} />);
    const button = screen.getByRole("button", { name: "Filter" });
    fireEvent.pointerDown(button);
    fireEvent.touchStart(button);
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    const backdrop = screen.getByTestId("filter-menu-backdrop");
    const outside = vi.fn();
    document.addEventListener("click", outside);
    fireEvent.click(backdrop);
    document.removeEventListener("click", outside);
    expect(screen.queryByRole("menu")).toBeNull();
    // The closing tap stopped at the backdrop: nothing behind it got the click.
    expect(outside).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("keeps focus in the menu: first row on open, card header on expand, trigger on collapse", () => {
    render(<FilterMenu state={makeState()} variant="mobile" viewOptions={viewOptions()} />);
    open();
    expect(screen.getByRole("menuitem", { name: "Filter" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "View Options" }));
    expect(screen.getByRole("menuitem", { name: "View Options" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "View Options" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "View Options" }));
    expect(screen.getByRole("menuitem", { name: "View Options" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "View Options" })).toHaveAttribute("aria-expanded", "false");
  });
});
