import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import { HiddenSession } from "./HiddenUnlock";
import HiddenView from "./HiddenView";

afterEach(() => vi.unstubAllGlobals());

const LOCKED = { detail: { code: "hidden_locked", message: "password required to open Hidden" } };

// #148: Hidden re-locks server-side after 5 idle minutes; the next request
// 403s `hidden_locked`. The view must show the password prompt, then resume.
describe.each(["mobile", "desktop"] as const)("HiddenView re-lock (%s)", (variant) => {
  it("shows the password prompt on hidden_locked and reloads the list after unlock", async () => {
    let hiddenCalls = 0;
    const fetchMock = mockFetch((url) => {
      if (url === "/api/libraries/1/hidden") {
        hiddenCalls += 1;
        if (hiddenCalls === 1) return jsonResponse(LOCKED, 403);
        return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
      }
      if (url === "/api/auth/reconfirm-password") return noContentResponse();
      throw new Error(`unexpected request: ${url}`);
    });

    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);

    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(hiddenCalls).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/reconfirm-password")).toBe(true);
  });

  it("cancel from the re-lock prompt calls onCancel", async () => {
    mockFetch(() => jsonResponse(LOCKED, 403));
    const onCancel = vi.fn();
    render(<HiddenView libraryId={1} variant={variant} onCancel={onCancel} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("other errors show an error with Retry, not the prompt or the empty state", async () => {
    let hiddenCalls = 0;
    mockFetch(() => {
      hiddenCalls += 1;
      if (hiddenCalls === 1) return jsonResponse({ detail: "boom" }, 500);
      return { items: [{ id: "a1", filename: "back.jpg" }], next_cursor: null };
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Couldn't load hidden photos.")).toBeInTheDocument();
    expect(screen.queryByText("No hidden photos.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("back.jpg")).toBeInTheDocument();
    expect(hiddenCalls).toBe(2);
  });
});

// #150: leaving Hidden in another tab calls lock-hidden, which re-locks the
// whole session. This tab's next request then 403s `hidden_locked`. HiddenView
// only ever requests the list (no paging, no viewer, no media yet), so every
// reachable 403 goes through the same prompt.
describe.each(["mobile", "desktop"] as const)("HiddenView locked from another tab (%s)", (variant) => {
  function sessionServer() {
    let locked = false;
    let listCalls = 0;
    mockFetch((url) => {
      if (url === "/api/auth/reconfirm-password") {
        locked = false;
        return noContentResponse();
      }
      if (url === "/api/libraries/1/hidden") {
        listCalls += 1;
        if (locked) return jsonResponse(LOCKED, 403);
        return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    return {
      lockFromOtherTab: () => {
        locked = true;
      },
      listCalls: () => listCalls,
    };
  }

  async function unlock() {
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  }

  it("Retry after a failed load, with Hidden locked meanwhile, shows the prompt then recovers", async () => {
    let listCalls = 0;
    let locked = false;
    mockFetch((url) => {
      if (url === "/api/auth/reconfirm-password") {
        locked = false;
        return noContentResponse();
      }
      listCalls += 1;
      if (listCalls === 1) return jsonResponse({ detail: "boom" }, 500);
      if (locked) return jsonResponse(LOCKED, 403);
      return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
    });
    // The other tab locks Hidden after the first (failed) load.
    locked = true;
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load hidden photos.")).not.toBeInTheDocument();
    await unlock();
    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
  });

  it("locked again between unlock and the reload shows the prompt again, not an error", async () => {
    const server = sessionServer();
    server.lockFromOtherTab();
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    await unlock();
    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
    expect(server.listCalls()).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a list that was open and unlocked, remounted after the other tab locked, prompts", async () => {
    const server = sessionServer();
    const first = render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
    first.unmount();
    server.lockFromOtherTab();
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    await unlock();
    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
  });
});

// #149: StrictMode's simulated mount/unmount/mount must not lock Hidden
// between unlock and the first list load.
describe("HiddenSession lock-on-leave", () => {
  // The deferred lock from a test's auto-unmount must fire before the next
  // test installs its own fetch mock.
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  function hiddenServer(startLocked: boolean) {
    let locked = startLocked;
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url === "/api/auth/reconfirm-password") {
        locked = false;
        return noContentResponse();
      }
      if (url === "/api/auth/lock-hidden") {
        locked = true;
        return noContentResponse();
      }
      if (url === "/api/libraries/1/hidden") {
        if (locked) return jsonResponse(LOCKED, 403);
        return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    return calls;
  }

  it("under StrictMode, unlock then first load succeeds with no lock call", async () => {
    const calls = hiddenServer(true);
    render(
      <StrictMode>
        <HiddenSession>
          <HiddenView libraryId={1} variant="mobile" onCancel={() => {}} />
        </HiddenSession>
      </StrictMode>,
    );
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("secret.jpg")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).not.toContain("/api/auth/lock-hidden");
  });

  it("a real unmount still locks", async () => {
    const calls = hiddenServer(false);
    const { unmount } = render(
      <StrictMode>
        <HiddenSession>
          <p>open</p>
        </HiddenSession>
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).not.toContain("/api/auth/lock-hidden");
    unmount();
    await waitFor(() => expect(calls).toContain("/api/auth/lock-hidden"));
  });
});
