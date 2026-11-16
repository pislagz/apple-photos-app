import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { filterEmptyMessages } from "./albumText";
import LibraryEmptyState from "./LibraryEmptyState";

describe("LibraryEmptyState (#263)", () => {
  it("shows the Admin → Libraries link for admins", () => {
    render(<LibraryEmptyState title="No Photos or Videos" text="Photos added to this library will appear here." adminLink />);
    expect(screen.getByRole("heading", { name: "No Photos or Videos" })).toBeInTheDocument();
    expect(screen.getByText("Photos added to this library will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Admin → Libraries" })).toHaveAttribute("href", "/admin");
  });

  it("hides the link for non-admins and for other empty states", () => {
    render(<LibraryEmptyState title="No Favorites" />);
    expect(screen.getByRole("heading", { name: "No Favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("LibraryEmptyState layout (#263 F5)", () => {
  it("fills its scroll area instead of a viewport fraction, so it centres vertically", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/shell/shell.css", "utf8");
    const rule = css.match(/\.library-empty \{[^}]*\}/)![0];
    expect(rule).toMatch(/height:\s*100%/);
    expect(rule).toMatch(/justify-content:\s*center/);
    expect(rule).not.toMatch(/60dvh/);
  });
});

describe("filter-aware empty state (#484)", () => {
  it("names the filter and clears it from a button", async () => {
    const clear = vi.fn();
    const { title, text } = filterEmptyMessages("videos");
    render(<LibraryEmptyState title={title} text={text} onClearFilter={clear} />);
    expect(screen.getByRole("heading", { name: "No Videos" })).toBeInTheDocument();
    expect(screen.getByText("No items match this filter.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filter" }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it("falls back to a generic title", () => {
    expect(filterEmptyMessages("all").title).toBe("No Items Match");
  });
});
