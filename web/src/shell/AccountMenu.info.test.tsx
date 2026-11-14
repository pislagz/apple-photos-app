import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AccountMenu from "./AccountMenu";

describe("AccountMenu info buttons", () => {
  it("explains Change password and Passkeys", () => {
    render(
      <AccountMenu
        me={{ id: 1, username: "anna", role: "user", libraries: [] } as never}
        onLogout={() => undefined}
      />,
    );
    for (const name of ["Change password", "Passkeys"]) {
      const button = screen.getByRole("button", { name: `About ${name}` });
      const tip = document.getElementById(button.getAttribute("aria-describedby")!);
      expect(tip?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the (i) right after each label, before the control", () => {
    render(
      <AccountMenu
        me={{ id: 1, username: "anna", role: "user", libraries: [] } as never}
        onLogout={() => undefined}
      />,
    );
    for (const name of ["Change password", "Passkeys"]) {
      expect(screen.getByRole("button", { name }).nextElementSibling).toHaveClass("info-button");
    }
  });
});
