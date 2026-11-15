import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom makes import.meta.url an http URL, so resolve from the file path instead.
const css = readFileSync(join(__dirname, "shell.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("login CSS (F1)", () => {
  it("lays the keep row out inline and centred", () => {
    const body = rule(".login-card label.login-card__keep");
    expect(body).toContain("flex-direction: row");
    expect(body).toContain("align-items: center");
  });

  it("styles the passkey note as a small secondary footnote with spacing", () => {
    const body = rule(".login-card .login-card__passkey-note");
    expect(body).toContain("var(--font-size-footnote)");
    expect(body).toContain("var(--color-label-secondary)");
    expect(body).toMatch(/margin: var\(--space-12\) 0 0/);
  });

  it("lays the hint out as text plus (i) inside the shared button", () => {
    const body = rule(".login-card .login-card__passkey-note .info-button--labelled");
    expect(body).toContain("display: inline-flex");
    expect(body).toContain("align-items: center");
    expect(body).not.toContain("cursor: pointer");
  });
});
