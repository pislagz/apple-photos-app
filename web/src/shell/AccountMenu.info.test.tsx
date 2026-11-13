import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AccountMenu from "./AccountMenu";

describe("AccountMenu info buttons", () => {
  it("explains Layout, Change password and Passkeys", () => {
    render(
      <AccountMenu
        me={{ id: 1, username: "anna", role: "user", libraries: [] } as never}
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

  it("keeps the (i) right after each label, before the control", () => {
    const { container } = render(
      <AccountMenu
        me={{ id: 1, username: "anna", role: "user", libraries: [] } as never}
        layoutOverride="auto"
        onLayoutOverrideChange={() => undefined}
        onLogout={() => undefined}
      />,
    );
    const layout = Array.from(container.querySelectorAll(".account-menu__row.layout-override")[0].children);
    expect(layout.map((el) => el.tagName)).toEqual(["LABEL", "BUTTON", "SELECT"]);
    expect(layout[1]).toHaveClass("info-button");
    expect(screen.getByLabelText("Layout").tagName).toBe("SELECT");
    for (const name of ["Change password", "Passkeys"]) {
      expect(screen.getByRole("button", { name }).nextElementSibling).toHaveClass("info-button");
    }
  });
});
