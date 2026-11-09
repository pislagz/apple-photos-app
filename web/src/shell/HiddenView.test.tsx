import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findThumb, getThumb, jsonResponse, mockFetch, noContentResponse, queryThumb } from "../testHelpers";
import { useFakeLayout } from "../testLayout";
import { HiddenSession } from "./HiddenUnlock";
import HiddenView from "./HiddenView";

afterEach(() => vi.unstubAllGlobals());

// HiddenSession defers its lock with setTimeout(0). Timers with equal delay
// fire in order, so a later setTimeout(0) runs after it: no wall-clock sleep.
const afterDeferredLock = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const LOCKED = { detail: { code: "hidden_locked", message: "password required to open Hidden" } };

// #148: Hidden re-locks server-side after 5 idle minutes; the next request
// 403s `hidden_locked`. The view must show the password prompt, then resume.
describe.each(["mobile", "desktop"] as const)("HiddenView re-lock (%s)", (variant) => {
  it("shows the password prompt on hidden_locked and reloads the list after unlock", async () => {
    let hiddenCalls = 0;
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/hidden")) {
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

    expect(await findThumb("a1")).toBeInTheDocument();
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
    expect(await findThumb("a1")).toBeInTheDocument();
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
      if (url.startsWith("/api/libraries/1/hidden")) {
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
    expect(await findThumb("a1")).toBeInTheDocument();
  });

  it("unlocking a locked Hidden reloads the list once more and shows no error", async () => {
    const server = sessionServer();
    server.lockFromOtherTab();
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    await unlock();
    expect(await findThumb("a1")).toBeInTheDocument();
    expect(server.listCalls()).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("locked again between unlock and the reload shows the prompt again, not an error", async () => {
    let listCalls = 0;
    mockFetch((url) => {
      if (url === "/api/auth/reconfirm-password") return noContentResponse();
      listCalls += 1;
      // The unlock succeeds, but the other tab locks again before the reload.
      if (listCalls <= 2) return jsonResponse(LOCKED, 403);
      return { items: [{ id: "a1", filename: "secret.jpg" }], next_cursor: null };
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    await unlock();
    // The first prompt unmounts when the reload starts; wait for the second
    // list request so the next findByText can only match the new prompt.
    await waitFor(() => expect(listCalls).toBe(2));
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await unlock();
    expect(await findThumb("a1")).toBeInTheDocument();
    expect(listCalls).toBe(3);
  });

  it("a list that was open and unlocked, remounted after the other tab locked, prompts", async () => {
    const server = sessionServer();
    const first = render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await findThumb("a1")).toBeInTheDocument();
    first.unmount();
    server.lockFromOtherTab();
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    await unlock();
    expect(await findThumb("a1")).toBeInTheDocument();
  });
});

// #149: StrictMode's simulated mount/unmount/mount must not lock Hidden
// between unlock and the first list load.
describe("HiddenSession lock-on-leave", () => {
  // The deferred lock from a test's auto-unmount must fire before the next
  // test installs its own fetch mock.
  afterEach(async () => {
    cleanup();
    await afterDeferredLock();
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
      if (url.startsWith("/api/libraries/1/hidden")) {
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
    expect(await findThumb("a1")).toBeInTheDocument();
    await afterDeferredLock();
    expect(calls).not.toContain("/api/auth/lock-hidden");
  });

  it("a new session in the same tick cancels the previous session's deferred lock (#172)", async () => {
    const calls = hiddenServer(false);
    const first = render(
      <HiddenSession>
        <p>one</p>
      </HiddenSession>,
    );
    first.unmount();
    render(
      <HiddenSession>
        <p>two</p>
      </HiddenSession>,
    );
    await afterDeferredLock();
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
    await afterDeferredLock();
    expect(calls).not.toContain("/api/auth/lock-hidden");
    unmount();
    await waitFor(() => expect(calls).toContain("/api/auth/lock-hidden"));
  });
});

// #156: the unlocked Hidden album is a thumbnail grid that opens the Viewer.
describe.each(["mobile", "desktop"] as const)("HiddenView grid (%s)", (variant) => {
  const page1 = { items: [{ id: "a1", filename: "one.jpg" }, { id: "a2", filename: "two.jpg" }], next_cursor: "c1" };
  const page2 = { items: [{ id: "a3", filename: "three.jpg" }], next_cursor: null };
  let observerCallback: IntersectionObserverCallback | null = null;

  function installObserver() {
    observerCallback = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  }
  // Scrolling is ignored while a page request is still marked in flight, and
  // that flag clears one microtask after the thumbnails render. Flush first, or
  // a slow run scrolls too early and nothing ever loads (the #170 flake).
  async function scrollToEnd() {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  }

  it("renders a thumbnail per hidden item, and opens the viewer on click", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/hidden")) return { items: page1.items, next_cursor: null };
      if (url.startsWith("/api/libraries/1/assets/")) return jsonResponse({ detail: "x" }, 404);
      return jsonResponse({}, 404);
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    const thumb = await findThumb("a1");
    expect(thumb).toHaveAttribute("src", "/api/libraries/1/thumb/a1?size=grid");
    expect(getThumb("a2")).toBeInTheDocument();
    fireEvent.click(thumb.closest("button")!);
    await waitFor(() =>
      expect(document.querySelector('img[src="/api/libraries/1/thumb/a1?size=preview"]')).not.toBeNull(),
    );
  });

  it("pages with the cursor when the end of the grid is reached", async () => {
    installObserver();
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      return url.includes("cursor=c1") ? page2 : page1;
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    await findThumb("a1");
    await scrollToEnd();
    expect(await findThumb("a3")).toBeInTheDocument();
    expect(getThumb("a1")).toBeInTheDocument();
    expect(urls.some((url) => url.includes("cursor=c1"))).toBe(true);
  });

  it("a hidden_locked 403 on load-more shows the prompt, and unlock reloads from the top", async () => {
    installObserver();
    let locked = false;
    mockFetch((url) => {
      if (url === "/api/auth/reconfirm-password") {
        locked = false;
        return noContentResponse();
      }
      if (url.includes("cursor=c1")) {
        locked = true;
        return jsonResponse(LOCKED, 403);
      }
      if (locked) return jsonResponse(LOCKED, 403);
      return page1;
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    await findThumb("a1");
    await scrollToEnd();
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
    expect(queryThumb("a1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await findThumb("a1")).toBeInTheDocument();
  });

  it("a thumbnail that fails because Hidden re-locked shows the prompt", async () => {
    let locked = false;
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/hidden")) return locked ? jsonResponse(LOCKED, 403) : page2;
      return jsonResponse({}, 404);
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    const thumb = await findThumb("a3");
    locked = true;
    fireEvent.error(thumb);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
  });

  it("a failed image while still unlocked leaves the grid alone", async () => {
    const fetchMock = mockFetch((url) => (url.startsWith("/api/libraries/1/hidden") ? page2 : jsonResponse({}, 404)));
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    fireEvent.error(await findThumb("a3"));
    // The probe is the second request. Await its response, then flush React,
    // so "no prompt" is checked after the probe finished, not before.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    await act(async () => {
      await fetchMock.mock.results[1].value;
    });
    expect(screen.queryByText("Hidden is locked")).not.toBeInTheDocument();
  });

  it("a viewer image failing after a re-lock shows the prompt", async () => {
    let locked = false;
    mockFetch((url) => {
      if (url.startsWith("/api/libraries/1/hidden")) return locked ? jsonResponse(LOCKED, 403) : page2;
      return jsonResponse(LOCKED, 403);
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    fireEvent.click((await findThumb("a3")).closest("button")!);
    const preview = await waitFor(() => {
      const el = document.querySelector('img[src="/api/libraries/1/thumb/a3?size=preview"]');
      expect(el).not.toBeNull();
      return el!;
    });
    locked = true;
    fireEvent.error(preview);
    expect(await screen.findByText("Hidden is locked")).toBeInTheDocument();
  });

  it("many broken thumbnails share one /hidden probe (#174)", async () => {
    const fetchMock = mockFetch((url) => (url.startsWith("/api/libraries/1/hidden") ? page1 : jsonResponse({}, 404)));
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    const a1 = await findThumb("a1");
    const a2 = getThumb("a2");
    for (let i = 0; i < 5; i += 1) {
      fireEvent.error(a1);
      fireEvent.error(a2);
    }
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    await act(async () => {
      await fetchMock.mock.results[1].value;
    });
    // The list load plus a single probe; the rest wait for the next window.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("paging: swiping/arrowing the Viewer to the last loaded photo loads the next page (#174)", async () => {
    installObserver();
    const urls: string[] = [];
    mockFetch((url) => {
      urls.push(url);
      if (url.startsWith("/api/libraries/1/hidden")) return url.includes("cursor=c1") ? page2 : page1;
      return jsonResponse({}, 404);
    });
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    fireEvent.click((await findThumb("a1")).closest("button")!);
    await waitFor(() =>
      expect(document.querySelector('img[src="/api/libraries/1/thumb/a1?size=preview"]')).not.toBeNull(),
    );
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(urls.some((url) => url.includes("cursor=c1"))).toBe(false);
    if (variant === "mobile") {
      const stage = screen.getByTestId("mobile-viewer-stage");
      fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 200 }] });
      fireEvent.touchMove(stage, { touches: [{ clientX: 180, clientY: 200 }] });
      fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 180, clientY: 200 }] });
    } else {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    }
    await waitFor(() => expect(urls.some((url) => url.includes("cursor=c1"))).toBe(true));
    expect(await findThumb("a3")).toBeInTheDocument();
  });

  it("paging: swiping to the last photo does not retry a failed page; Retry does", async () => {
    installObserver();
    const urls: string[] = [];
    let failCursor = true;
    mockFetch((url) => {
      urls.push(url);
      if (url.startsWith("/api/libraries/1/hidden")) {
        if (!url.includes("cursor=c1")) return page1;
        return failCursor ? jsonResponse({ detail: "boom" }, 500) : page2;
      }
      return jsonResponse({}, 404);
    });
    const cursorCalls = () => urls.filter((url) => url.includes("cursor=c1")).length;
    render(<HiddenView libraryId={1} variant={variant} onCancel={() => {}} />);
    await findThumb("a1");
    await scrollToEnd();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(cursorCalls()).toBe(1);
    fireEvent.click(getThumb("a1").closest("button")!);
    await waitFor(() =>
      expect(document.querySelector('img[src="/api/libraries/1/thumb/a1?size=preview"]')).not.toBeNull(),
    );
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    if (variant === "mobile") {
      const stage = screen.getByTestId("mobile-viewer-stage");
      fireEvent.touchStart(stage, { touches: [{ clientX: 300, clientY: 200 }] });
      fireEvent.touchMove(stage, { touches: [{ clientX: 180, clientY: 200 }] });
      fireEvent.touchEnd(stage, { touches: [], changedTouches: [{ clientX: 180, clientY: 200 }] });
    } else {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    }
    await waitFor(() =>
      expect(document.querySelector('img[src="/api/libraries/1/thumb/a2?size=preview"]')).not.toBeNull(),
    );
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(cursorCalls()).toBe(1);
    failCursor = false;
    fireEvent.click(retry);
    await waitFor(() => expect(cursorCalls()).toBe(2));
  });
});

describe("HiddenView virtualization (#174)", () => {
  useFakeLayout({ width: 800, height: 600 });

  it("renders only the rows near the viewport of a large album", async () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: `x${i}`, filename: `${i}.jpg` }));
    mockFetch(() => ({ items, next_cursor: null }));
    render(<HiddenView libraryId={1} variant="desktop" onCancel={() => {}} />);
    await findThumb("x0");
    const rendered = document.querySelectorAll(".hidden-view__thumb").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200);
    expect(queryThumb("x1999")).not.toBeInTheDocument();
  });
});
