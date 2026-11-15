import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Footer, GroupedList, Row } from "./GroupedList";
import SavedStatus, { useSaveStatus } from "./SavedStatus";
import Sheet from "./Sheet";
import SkeletonRow from "./SkeletonRow";
import Switch from "./Switch";

afterEach(() => vi.useRealTimers());

describe("Switch", () => {
  function Harness({ onChange = () => {} }: { onChange?: (v: boolean) => void }) {
    const [on, setOn] = useState(false);
    return <Switch label="Allow downloads" checked={on} onChange={(v) => { setOn(v); onChange(v); }} />;
  }

  it("toggles and reports aria-checked", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Allow downloads" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<Switch label="X" checked disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("GroupedList and Row", () => {
  it("renders heading, rows, values, controls and footer", () => {
    render(
      <GroupedList heading="General" footer="Saved automatically.">
        <Row label="Name" detail="Shown to everyone" value="Family" />
        <Row label="Quiet" control={<Switch label="Quiet" checked onChange={() => {}} />} />
      </GroupedList>,
    );
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Shown to everyone")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(screen.getByText("Saved automatically.")).toBeInTheDocument();
  });

  it("an action row is one button; a destructive one is marked", async () => {
    const onClick = vi.fn();
    render(
      <GroupedList>
        <Row label="Remove" destructive onClick={onClick} size="touch" />
      </GroupedList>,
    );
    const button = screen.getByRole("button", { name: /Remove/ });
    expect(button).toHaveAttribute("data-size", "touch");
    expect(button.className).toContain("admin-row--destructive");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("Footer renders text", () => {
    render(<Footer>Hello</Footer>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("SkeletonRow", () => {
  it("is hidden from assistive tech", () => {
    const { container } = render(<SkeletonRow />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SavedStatus", () => {
  it("shows the text for each state in a polite live region", () => {
    const { rerender } = render(<SavedStatus state="idle" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    rerender(<SavedStatus state="saving" />);
    expect(status).toHaveTextContent("Saving…");
    rerender(<SavedStatus state="saved" />);
    expect(status).toHaveTextContent("Saved");
    rerender(<SavedStatus state="error" message="No network" />);
    expect(status).toHaveTextContent("No network");
  });

  it("useSaveStatus goes saving, saved, then back to idle", async () => {
    vi.useFakeTimers();
    function H({ fail = false }: { fail?: boolean }) {
      const { state, run } = useSaveStatus();
      return (
        <button type="button" onClick={() => run(() => (fail ? Promise.reject(new Error("Nope")) : Promise.resolve()))}>
          {state}
        </button>
      );
    }
    const { unmount } = render(<H />);
    const b = screen.getByRole("button");
    await act(async () => { fireEvent.click(b); });
    expect(b).toHaveTextContent("saved");
    act(() => { vi.advanceTimersByTime(2100); });
    expect(b).toHaveTextContent("idle");
    unmount();
    render(<H fail />);
    await act(async () => { fireEvent.click(screen.getByRole("button")); });
    expect(screen.getByRole("button")).toHaveTextContent("error");
  });
});

describe("Sheet", () => {
  function Harness({ onDo = () => {}, onClose = () => {} }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
        {open && (
          <Sheet
            title="Remove this library?"
            onClose={() => { setOpen(false); onClose(); }}
            actions={[{ label: "Remove", kind: "destructive", onClick: onDo }]}
          >
            It stays on the drive.
          </Sheet>
        )}
      </>
    );
  }

  it("is a labelled, described modal dialog with Cancel focused", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this library?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("It stays on the drive.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Remove" }).className).toContain("admin-btn--danger-fill");
  });

  it("Escape closes and focus returns to the opener", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus(); // fireEvent.click does not move focus in jsdom
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  });

  it("Cancel closes and the action runs without closing by itself", async () => {
    const onDo = vi.fn();
    render(<Harness onDo={onDo} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("traps Tab and Shift+Tab inside", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const remove = screen.getByRole("button", { name: "Remove" });
    const dialog = screen.getByRole("dialog");
    remove.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(remove).toHaveFocus();
  });
});
