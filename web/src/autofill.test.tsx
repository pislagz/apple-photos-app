import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "./admin/testHelpers";
import AddLibrarySheet from "./admin/screens/AddLibrarySheet";
import { NO_AUTOFILL } from "./noAutofill";
import ChangePasswordDialog from "./shell/ChangePasswordDialog";
import { HiddenUnlock } from "./shell/HiddenUnlock";
import LoginScreen from "./shell/LoginScreen";
import SetupScreen from "./shell/SetupScreen";

// #472: Safari AutoFill on a non-credential field makes the installed Mac web app
// ask for the "Safari Forms AutoFill Encryption Key". Only sign-in and password
// fields may invite AutoFill, and they must carry the right token.

const NOT_TEXT = new Set(["checkbox", "radio", "range", "file", "hidden", "button", "submit", "color"]);

// file -> credential tokens, in source order.
const CREDENTIALS: Record<string, string[]> = {
  "shell/LoginScreen.tsx": ["username", "current-password"],
  // #519: the Family login password step.
  "shell/ProfilePicker.tsx": ["current-password"],
  "shell/SetupScreen.tsx": ["username", "new-password"],
  "shell/ChangePasswordDialog.tsx": ["current-password", "new-password", "new-password"],
  "shell/PasskeysDialog.tsx": ["current-password"],
  "shell/HiddenUnlock.tsx": ["current-password"],
  "admin/AdminApp.tsx": ["username", "current-password"],
  // An admin setting another person's password.
  "admin/screens/PeopleSheets.tsx": ["new-password", "new-password", "new-password", "new-password"],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });
}

// Returns the opening tag of each <input>/<textarea>, skipping `>` inside {...} and strings.
function fieldTags(text: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const start = /<(input|textarea)\b/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    let depth = 0;
    let quote: string | null = null;
    let i = match.index + match[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: text.slice(match.index, i + 1), line: text.slice(0, match.index).split("\n").length });
  }
  return out;
}

describe("AutoFill off outside sign-in fields (#472)", () => {
  const root = __dirname;
  const files = sources(root).map((path) => ({ rel: relative(root, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));

  it("finds the fields it guards", () => {
    const all = files.flatMap((f) => fieldTags(f.text));
    expect(all.length).toBeGreaterThan(25);
  });

  it("every non-credential text field spreads NO_AUTOFILL", () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      for (const { tag, line } of fieldTags(text)) {
        const type = /\btype="([^"]+)"/.exec(tag)?.[1];
        if (type && NOT_TEXT.has(type)) continue;
        const token = /\bautoComplete="([^"]+)"/.exec(tag)?.[1];
        if (token && token !== "off") continue; // credential, checked below
        if (!tag.includes("{...NO_AUTOFILL}")) bad.push(`${rel}:${line}`);
        if (/\b(name|id)="[^"]*\b(name|e-?mail|address|phone|tel|city|country|zip|postal)\b/i.test(tag)) bad.push(`${rel}:${line} contact-like name/id`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("credential fields keep their AutoFill tokens, and only those files have them", () => {
    const found: Record<string, string[]> = {};
    for (const { rel, text } of files) {
      for (const { tag } of fieldTags(text)) {
        const token = /\bautoComplete="([^"]+)"/.exec(tag)?.[1];
        if (!token || token === "off") continue;
        (found[rel] ??= []).push(token);
        if (token.endsWith("password")) expect(tag, rel).toMatch(/type="password"/);
      }
    }
    expect(found).toEqual(CREDENTIALS);
  });

  it("NO_AUTOFILL carries the Safari hints", () => {
    expect(NO_AUTOFILL).toEqual({
      autoComplete: "off",
      autoCorrect: "off",
      autoCapitalize: "off",
      spellCheck: false,
      "data-form-type": "other",
    });
  });
});

describe("rendered fields (#472)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function expectOff(el: HTMLElement) {
    expect(el).toHaveAttribute("autocomplete", "off");
    expect(el).toHaveAttribute("autocorrect", "off");
    expect(el).toHaveAttribute("autocapitalize", "off");
    expect(el).toHaveAttribute("spellcheck", "false");
    expect(el).toHaveAttribute("data-form-type", "other");
  }

  it("Add Library: path and name fields and their form", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/library-candidates") return { folders: [], candidates: [] };
      throw new Error(`unexpected request: ${url}`);
    });
    render(<AddLibrarySheet onClose={vi.fn()} onAdded={vi.fn()} />);
    await screen.findByText("Advanced");
    const path = screen.getByLabelText("Path");
    const name = screen.getByLabelText("Name (optional)");
    expectOff(path);
    expectOff(name);
    expect(path.closest("form")).toHaveAttribute("autocomplete", "off");
    expectOff(screen.getByLabelText("Add a folder"));
    for (const el of [path, name]) expect(el.getAttribute("name") ?? "").not.toMatch(/name/i);
  });

  it("Login keeps username and current-password", () => {
    render(<LoginScreen layout="desktop" error={null} onSubmit={() => {}} />);
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("Setup keeps username and new-password", () => {
    render(<SetupScreen layout="desktop" error={null} onSubmit={() => {}} />);
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("Change password keeps current-password and new-password", () => {
    render(<ChangePasswordDialog onClose={() => {}} />);
    expect(screen.getByLabelText("Current password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("Hidden unlock keeps current-password", () => {
    render(<HiddenUnlock variant="desktop" onUnlocked={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("Login is a real post form with stable ids, and submits values set without typing (#511)", () => {
    const onSubmit = vi.fn();
    render(<LoginScreen layout="desktop" error={null} onSubmit={onSubmit} />);
    const user = screen.getByLabelText("Username") as HTMLInputElement;
    const pass = screen.getByLabelText("Password") as HTMLInputElement;
    expect(user.closest("form")).toHaveAttribute("method", "post");
    expect(user).toHaveAttribute("name", "username");
    expect(pass).toHaveAttribute("name", "password");
    expect(user.id).toBeTruthy();
    expect(pass.id).toBeTruthy();
    for (const el of [user, pass]) {
      expect(el).not.toHaveAttribute("autocomplete", "off");
      expect(el).not.toHaveAttribute("data-1p-ignore");
      expect(el).not.toHaveAttribute("data-form-type");
    }
    // AutoFill assigns the value with no key or input events.
    user.value = "filled-user";
    pass.value = "filled-pass";
    fireEvent.submit(user.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith("filled-user", "filled-pass", true);
    // Fields keep their nodes and values across a re-render.
    expect(screen.getByLabelText("Username")).toBe(user);
  });

  it("Setup submits values set without typing (#511)", () => {
    const onSubmit = vi.fn();
    render(<SetupScreen layout="desktop" error={null} onSubmit={onSubmit} />);
    const user = screen.getByLabelText("Username") as HTMLInputElement;
    const pass = screen.getByLabelText("Password") as HTMLInputElement;
    expect(user).toHaveAttribute("name", "username");
    expect(pass).toHaveAttribute("name", "password");
    user.value = "admin";
    pass.value = "a-long-pass";
    fireEvent.submit(user.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith("admin", "a-long-pass", { osm_consent: false });
  });
});
