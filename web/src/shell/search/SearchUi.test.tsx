import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import SearchField from "./SearchField";
import SuggestionList from "./SuggestionList";

function Harness({ initial = [] as { kind: "person" | "text"; label: string }[] }) {
  const [tokens, setTokens] = useState(initial);
  const [text, setText] = useState("");
  return (
    <SearchField
      variant="desktop"
      value={text}
      onChange={setText}
      tokens={tokens}
      onRemoveToken={(i) => setTokens((t) => t.filter((_, j) => j !== i))}
    />
  );
}

describe("SearchField tokens", () => {
  it("removes a token with its own button", () => {
    render(<Harness initial={[{ kind: "person", label: "Anna" }, { kind: "text", label: "dog" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Anna" }));
    expect(screen.queryByText("Anna")).not.toBeInTheDocument();
    expect(screen.getByText("dog")).toBeInTheDocument();
  });

  it("Backspace in an empty field removes the last token", () => {
    render(<Harness initial={[{ kind: "person", label: "Anna" }, { kind: "text", label: "dog" }]} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Backspace" });
    expect(screen.queryByText("dog")).not.toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
  });

  it("collapses the text after three tokens but keeps a way to remove each", () => {
    const four = ["a", "b", "c", "d"].map((label) => ({ kind: "text" as const, label }));
    render(<Harness initial={four} />);
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(4);
  });
});

describe("SuggestionList", () => {
  const rows = [
    { key: "free" as const, kind: "text" as const, title: "Search for “a”", detail: "" },
    { key: "person:1", kind: "person" as const, title: "Anna", detail: "Person" },
  ];

  it("marks the active row and picks on click", () => {
    const onPick = vi.fn();
    render(<SuggestionList id="x" rows={rows} activeIndex={1} onPick={onPick} />);
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(options[1]);
    expect(onPick).toHaveBeenCalledWith(rows[1]);
  });
});
