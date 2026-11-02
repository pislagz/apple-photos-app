import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../testHelpers";
import AuditLogScreen from "./AuditLogScreen";

const ENTRY = {
  id: 1,
  occurred_at: "2026-01-01T00:00:00Z",
  action: "login",
  actor: "alice",
  user_id: 1,
  username: "alice",
  library_id: null,
  library_display_name: null,
  asset_id: null,
  detail: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuditLogScreen", () => {
  it("lists audit log entries and exposes a CSV export link", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/audit-log") return { entries: [ENTRY] };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<AuditLogScreen />);

    expect(await screen.findByText("login")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/admin/audit-log.csv");
  });
});
