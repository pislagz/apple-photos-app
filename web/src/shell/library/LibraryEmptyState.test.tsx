import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
