import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, noContentResponse } from "../testHelpers";
import PeopleScreen from "./PeopleScreen";

const USER_A = { id: 1, username: "alice", role: "admin", disabled: false, created_at: "2026-01-01" };
const USER_B = { id: 2, username: "bob", role: "user", disabled: false, created_at: "2026-01-01" };
const LIBRARY = { id: 10, display_name: "Family", path: "/libraries/Family.photoslibrary", created_at: "2026-01-01" };
const MATRIX = { users: [USER_A, USER_B], libraries: [LIBRARY], assignments: { "1": [10], "2": [] } };
const FUTURE = new Date(Date.now() + 3 * 86400_000).toISOString();

type Handler = (url: string, init?: RequestInit) => unknown;
function setup(extra: Handler = () => undefined, matrix: unknown = MATRIX, invites: unknown[] = []) {
  const fetchMock = mockFetch((url, init) => {
    if (url === "/api/admin/access-matrix") return matrix;
    if (url === "/api/admin/invites" && !init?.method) return invites;
    const result = extra(url, init);
    if (result !== undefined) return result as never;
    throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
  });
  const calls = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
  return { fetchMock, calls };
}

async function openPerson(name: string, current = "alice") {
  render(<PeopleScreen currentUsername={current} />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { name, level: 1 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PeopleScreen", () => {
  it("lists people with a plain summary, tags you, and has no matrix", async () => {
    setup();
    render(<PeopleScreen currentUsername="alice" />);
    expect(await screen.findByRole("heading", { name: "People", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /alice.*You.*Administrator · 1 library/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bob.*Can see 0 libraries/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/can see Family/)).not.toBeInTheDocument();
    expect(screen.getByText("No open invitations.")).toBeInTheDocument();
  });

  it("shows Turned off for a disabled person", async () => {
    setup(() => undefined, { ...MATRIX, users: [USER_A, { ...USER_B, disabled: true }] });
    render(<PeopleScreen currentUsername="alice" />);
    expect(await screen.findByRole("button", { name: /bob.*Turned off/ })).toBeInTheDocument();
  });

  it("turns someone off with a switch that saves at once", async () => {
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users/bob" && init?.method === "PATCH") return { ...USER_B, disabled: true };
    });
    await openPerson("bob");
    fireEvent.click(screen.getByRole("switch", { name: "bob is allowed to sign in" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toEqual({ disabled: true });
  });

  it("blocks turning off or demoting your own account, with a reason", async () => {
    const { calls } = setup();
    await openPerson("alice");
    const sw = screen.getByRole("switch", { name: "alice is allowed to sign in" });
    expect(sw).toBeDisabled();
    expect(screen.getByText(/You can't turn off your own account/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Role/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /Person/ })).toBeDisabled();
    expect(within(dialog).getByText(/can't remove your own administrator access/)).toBeInTheDocument();
    expect(calls("PATCH")).toHaveLength(0);
    // And you cannot delete yourself.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: /Delete User/ })).not.toBeInTheDocument();
    expect(screen.getByText(/can't delete your own account/)).toBeInTheDocument();
  });

  it("changes a role through the sheet", async () => {
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users/bob" && init?.method === "PATCH") return { ...USER_B, role: "admin" };
    });
    await openPerson("bob");
    fireEvent.click(screen.getByRole("button", { name: /^Role/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Administrator/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toEqual({ role: "admin" });
  });

  it("asks twice for the new password and never uses window.prompt", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users/bob" && init?.method === "PATCH") return USER_B;
    });
    await openPerson("bob");
    fireEvent.click(screen.getByRole("button", { name: /Change Password/ }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Change Password" });
    const [first, second] = within(dialog).getAllByLabelText(/password|again/i, { selector: "input" });
    fireEvent.change(first, { target: { value: "short" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at least 12");
    fireEvent.change(first, { target: { value: "a-long-password-1" } });
    fireEvent.change(second, { target: { value: "a-long-password-2" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("not the same");
    expect(save).toBeDisabled();
    fireEvent.change(second, { target: { value: "a-long-password-1" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toEqual({ password: "a-long-password-1" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("confirms a delete by name and never uses window.confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users/bob" && init?.method === "DELETE") return noContentResponse();
    });
    await openPerson("bob");
    fireEvent.click(screen.getByRole("button", { name: /Delete User/ }));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "bob"?' });
    expect(calls("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete User" }));
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(await screen.findByRole("heading", { name: "People", level: 1 })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("cancelling the delete sheet deletes nothing", async () => {
    const { calls } = setup();
    await openPerson("bob");
    fireEvent.click(screen.getByRole("button", { name: /Delete User/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(calls("DELETE")).toHaveLength(0);
  });

  it("per-library switch: on saves at once, off asks first naming person and library", async () => {
    const { calls } = setup((url) => {
      if (url === "/api/admin/users/2/libraries/10") return noContentResponse();
    });
    await openPerson("bob");
    const sw = screen.getByRole("switch", { name: "bob can see Family" });
    fireEvent.click(sw);
    await waitFor(() => expect(calls("PUT")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removing access names the person and library", async () => {
    const { calls } = setup((url) => {
      if (url === "/api/admin/users/1/libraries/10") return noContentResponse();
    });
    await openPerson("alice");
    fireEvent.click(screen.getByRole("switch", { name: "alice can see Family" }));
    const dialog = await screen.findByRole("dialog", { name: 'Stop sharing "Family" with alice?' });
    expect(calls("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop Sharing" }));
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
  });

  it("shows Unlock only for a locked account", async () => {
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users/bob/unlock" && init?.method === "POST") return { username: "bob" };
    }, { ...MATRIX, users: [USER_A, { ...USER_B, locked: true }] });
    await openPerson("bob");
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
  });

  it("does not show Unlock for an account that is not locked", async () => {
    setup();
    await openPerson("bob");
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
  });

  it("creates an invitation link with a Copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    setup((url, init) => {
      if (url === "/api/admin/invites" && init?.method === "POST") return jsonResponse({ code: "abc", role: "user", expires_at: FUTURE }, 201);
    });
    render(<PeopleScreen currentUsername="alice" />);
    fireEvent.click(await screen.findByRole("button", { name: /Invite Someone/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Link" }));
    const field = (await within(dialog).findByLabelText("Invitation link")) as HTMLInputElement;
    expect(field.value).toMatch(/\/invite\/abc$/);
    expect(field).toHaveAttribute("readonly");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value));
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(within(dialog).getByText(/shown only now/)).toBeInTheDocument();
  });

  it("lists only open invitations and cancels one", async () => {
    const open = { id: "i1", role: "user", created_by: "alice", created_at: "2026-11-12 10:00:00", expires_at: FUTURE, used_at: null };
    const used = { ...open, id: "i2", used_at: "2026-11-12 11:00:00" };
    const old = { ...open, id: "i3", expires_at: "2020-01-01 00:00:00" };
    const { calls } = setup(
      (url, init) => {
        if (url === "/api/admin/invites/i1" && init?.method === "DELETE") return noContentResponse();
      },
      MATRIX,
      [open, used, old],
    );
    render(<PeopleScreen currentUsername="alice" />);
    const cancel = await screen.findAllByRole("button", { name: /Cancel the invitation/ });
    expect(cancel).toHaveLength(1);
    fireEvent.click(cancel[0]);
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
  });

  it("adds a person only when both passwords match", async () => {
    const { calls } = setup((url, init) => {
      if (url === "/api/admin/users" && init?.method === "POST") return jsonResponse({ ...USER_B, id: 3, username: "cy" }, 201);
    });
    render(<PeopleScreen currentUsername="alice" />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Person/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "cy" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "a-long-password-1" } });
    const add = within(dialog).getByRole("button", { name: "Add Person" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Type it again"), { target: { value: "a-long-password-1" } });
    fireEvent.click(add);
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1]!.body as string)).toEqual({ username: "cy", password: "a-long-password-1", role: "user" });
  });
});
