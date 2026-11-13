import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AccountMenu from "./AccountMenu";

describe("AccountMenu info buttons", () => {
  it("explains Layout, Change password and Passkeys", () => {
    render(
      <AccountMenu
        me={{ id: 1, username: "anna", role: "user" } as never}
        layoutOverride="auto"
        onLayoutOverrideChange={() => undefined}
        onLogout={() => undefined}
      />,
    );
    for (const name of ["Layout", "Change password", "Passkeys"]) {
      const button = screen.getByRole("button", { name: `About ${name}` });
      const tip = document.getElementById(button.getAttribute("aria-describedby")!);
      expect(tip?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
