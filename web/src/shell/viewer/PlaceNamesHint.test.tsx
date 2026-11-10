import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceInfoContext } from "../PlaceInfoContext";
import { InfoRows } from "./InfoRows";
import { buildInfoRows } from "./viewerInfo";

const DETAIL = {
  place: null,
  place_address: null,
  place_offline: null,
  latitude: 52.2297,
  longitude: 21.0122,
  people: [],
  albums: [],
  date_created: null,
  camera_make: null,
  camera_model: null,
} as never;

function renderRows(detail: never, consent: boolean, canChangeSettings: boolean) {
  render(
    <PlaceInfoContext.Provider value={{ consent, canChangeSettings }}>
      <InfoRows rows={buildInfoRows(detail)} className="info" />
    </PlaceInfoContext.Provider>,
  );
}

describe("coordinates without a place name", () => {
  it("shows an info button with the explanation and a Settings link for an admin", () => {
    renderRows(DETAIL, false, true);
    expect(screen.getByText(/52\.2297° N, 21\.0122° E/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Why is there no place name?" });
    const tip = screen.getByRole("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip).toHaveTextContent(
      "Place names are off because you haven't agreed to use OpenStreetMap data. You can change this in Settings.",
    );
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/admin#map-place-names");
    // A tap pins it open (the iPhone has no hover); a second tap closes it.
    expect(tip.className).not.toContain("--open");
    fireEvent.click(button);
    expect(tip.className).toContain("--open");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(tip.className).not.toContain("--open");
  });

  it("says an admin can change it, without a link, for other users", () => {
    renderRows(DETAIL, false, false);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Place names are off because you haven't agreed to use OpenStreetMap data. An admin can change this in Settings.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows plain coordinates once consent is given (the download may be pending)", () => {
    renderRows(DETAIL, true, true);
    expect(screen.getByText(/52\.2297° N, 21\.0122° E/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no icon when Photos supplied a name or there is no GPS", () => {
    renderRows({ ...(DETAIL as object), place: "Zürich" } as never, false, true);
    expect(screen.getByText("Zürich")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
