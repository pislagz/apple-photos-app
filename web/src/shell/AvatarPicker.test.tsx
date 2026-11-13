import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import AvatarPicker from "./AvatarPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LIBS = [
  { id: 1, display_name: "Family", updating: false, updating_reason: null, updated_note: null },
  { id: 2, display_name: "Travel", updating: false, updating_reason: null, updated_note: null },
];
const ITEM = {
  id: "a1",
  filename: "IMG_1.jpg",
  original_filename: "IMG_1.jpg",
  date: null,
  is_video: false,
  is_live_photo: false,
  favorite: false,
  width: 400,
  height: 200,
  duration: null,
};

async function toCropStep() {
  vi.spyOn(api, "getAssets").mockResolvedValue({ items: [ITEM], next_cursor: null });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<AvatarPicker libraries={LIBS} initialLibraryId={2} onClose={onClose} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole("listitem", { name: "Use IMG_1.jpg" }));
  const img = document.querySelector<HTMLImageElement>(".avatar-picker__photo")!;
  Object.defineProperty(img, "naturalWidth", { value: 400 });
  Object.defineProperty(img, "naturalHeight", { value: 200 });
  fireEvent.load(img);
  return { onSaved, onClose };
}

describe("AvatarPicker (#256)", () => {
  it("lists photos of the chosen library, in plain words", async () => {
    const spy = vi.spyOn(api, "getAssets").mockResolvedValue({ items: [ITEM], next_cursor: null });
    render(<AvatarPicker libraries={LIBS} initialLibraryId={2} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("heading", { name: "Choose a photo" })).toBeInTheDocument();
    await screen.findByRole("listitem", { name: "Use IMG_1.jpg" });
    expect(spy).toHaveBeenCalledWith(2, null, 60, null, "photos");
    fireEvent.change(screen.getByLabelText("Photo library"), { target: { value: "1" } });
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(1, null, 60, null, "photos"));
  });

  it("saves the framed square; keyboard moves and zooms", async () => {
    const save = vi.spyOn(api, "setAvatar").mockResolvedValue({ avatar_version: 5 });
    const { onSaved, onClose } = await toCropStep();
    const stage = screen.getByRole("group", { name: /Drag the photo/ });
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    fireEvent.keyDown(stage, { key: "+" });
    expect(screen.getByLabelText("Zoom")).not.toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [lib, asset, crop] = save.mock.calls[0];
    expect([lib, asset]).toEqual([2, "a1"]);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1.0001);
    expect(crop.width).toBeLessThan(0.5);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it("says so when the photo is no longer available", async () => {
    vi.spyOn(api, "setAvatar").mockRejectedValue(new api.ApiError(404, "not found"));
    await toCropStep();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn’t available any more");
  });

  it("goes back to the photos, and Escape closes", async () => {
    const { onClose } = await toCropStep();
    fireEvent.click(screen.getByRole("button", { name: "Choose another photo" }));
    expect(screen.getByRole("heading", { name: "Choose a photo" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
