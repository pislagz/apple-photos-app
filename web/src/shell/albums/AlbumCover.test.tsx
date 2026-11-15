import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlbumNode, AlbumsResponse } from "../../api";
import { mockFetch } from "../../testHelpers";
import AlbumCover, { coverIds } from "./AlbumCover";
import AlbumsOverview from "./AlbumsOverview";

const node = (id: string, cover_id: string | null, children: AlbumNode[] = [], kind: AlbumNode["kind"] = "album"): AlbumNode => ({
  id,
  kind,
  title: id,
  count: kind === "folder" ? null : 3,
  cover_id,
  children,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("coverIds", () => {
  it("uses the album's own cover first, then covers of what a folder holds (max 4)", () => {
    expect(coverIds(node("A", "x"))).toEqual(["x"]);
    const folder = node("F", null, [node("a", "1"), node("b", null), node("c", "2"), node("d", "3"), node("e", "4"), node("f", "5")], "folder");
    expect(coverIds(folder)).toEqual(["1", "2", "3", "4"]);
    expect(coverIds(node("E", null))).toEqual([]);
  });
});

describe("AlbumCover", () => {
  it("renders a 2x2 mosaic, one image, or an icon tile", () => {
    const folder = node("F", null, ["1", "2", "3", "4"].map((c) => node(`a${c}`, c)), "folder");
    const { container, rerender } = render(<AlbumCover libraryId={1} node={folder} />);
    expect(container.querySelector(".album-cover--mosaic")).not.toBeNull();
    expect(container.querySelectorAll(".album-cover__img")).toHaveLength(4);
    expect(container.querySelectorAll(".album-cover__blank")).toHaveLength(0);
    // Fewer than four covers: one photo, never grey squares.
    const small = node("S", null, [node("a", "1"), node("b", "2")], "folder");
    rerender(<AlbumCover libraryId={1} node={small} />);
    expect(container.querySelector(".album-cover--mosaic")).toBeNull();
    expect(container.querySelectorAll(".album-cover__img")).toHaveLength(1);
    expect(container.querySelectorAll(".album-cover__blank")).toHaveLength(0);
    rerender(<AlbumCover libraryId={1} node={node("A", "x")} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/libraries/1/thumb/x?size=grid2x");
    rerender(<AlbumCover libraryId={1} node={node("E", null)} />);
    expect(container.querySelector(".album-cover--empty svg")).not.toBeNull();
  });
});

describe("AlbumsOverview", () => {
  const albums: AlbumsResponse = {
    tree: [node("Trips", null, [node("Paris", "p")], "folder"), node("Loose", "l")],
    smart: [],
  };

  it("shows name and count, opens a folder in place with Back, and opens an album", async () => {
    mockFetch(() => albums);
    const onOpen = vi.fn();
    render(<AlbumsOverview libraryId={1} onOpen={onOpen} />);
    expect(await screen.findByRole("button", { name: /Loose/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Trips/ })).toHaveTextContent("1 item");
    fireEvent.click(screen.getByRole("button", { name: /Trips/ }));
    expect(screen.getByRole("heading", { name: "Trips" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Paris/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "Paris" }));
    fireEvent.click(screen.getByRole("button", { name: "Albums" }));
    expect(await screen.findByRole("button", { name: /Loose/ })).toBeInTheDocument();
  });

  it("says so plainly when there are no albums, and offers Retry on failure", async () => {
    mockFetch(() => ({ tree: [], smart: [] }));
    render(<AlbumsOverview libraryId={1} onOpen={() => {}} />);
    expect(await screen.findByText("There are no albums in this library yet.")).toBeInTheDocument();
    cleanup();
    mockFetch(() => new Response("no", { status: 500 }));
    render(<AlbumsOverview libraryId={1} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load albums."));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
