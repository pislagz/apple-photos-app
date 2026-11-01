import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

// P1.1 placeholder: proves the Vite/React/TS/vitest skeleton actually runs.
// P1.11 replaces this with the real shell (layout, login, PWA chrome).
describe("App", () => {
  it("renders", () => {
    render(<App />);

    expect(screen.getByText("Photos")).toBeInTheDocument();
  });
});
