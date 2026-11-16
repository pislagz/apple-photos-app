import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { routeScrollKey, scrollKeyTop } from "./scrollKeys";

// #458: desktop admin content is its own scroller; keys aimed at the page reach it.
const box = { top: 500, page: 700, max: 2000 };

describe("scrollKeyTop", () => {
  it("maps the scroll keys and clamps to the scroll range", () => {
    expect(scrollKeyTop("ArrowDown", false, box)).toBe(540);
    expect(scrollKeyTop("ArrowUp", false, box)).toBe(460);
    expect(scrollKeyTop("PageDown", false, box)).toBe(1160);
    expect(scrollKeyTop("PageUp", false, box)).toBe(0);
    expect(scrollKeyTop(" ", false, box)).toBe(1160);
    expect(scrollKeyTop(" ", true, box)).toBe(0);
    expect(scrollKeyTop("Home", false, box)).toBe(0);
    expect(scrollKeyTop("End", false, box)).toBe(2000);
    expect(scrollKeyTop("PageDown", false, { ...box, top: 1900 })).toBe(2000);
    expect(scrollKeyTop("a", false, box)).toBeNull();
  });
});

describe("routeScrollKey", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setup() {
    document.body.innerHTML = `<nav><button id="b">People</button></nav>
      <main id="m" style="overflow-y: auto"><input id="i" /></main>`;
    const main = document.getElementById("m")!;
    Object.defineProperty(main, "clientHeight", { value: 700 });
    Object.defineProperty(main, "scrollHeight", { value: 3000 });
    return main;
  }

  function press(target: EventTarget, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    return event;
  }

  it("scrolls the content for keys sent to the page or a sidebar button", () => {
    const main = setup();
    const e = press(document.body, "PageDown");
    expect(routeScrollKey(e, main)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(main.scrollTop).toBe(660);
    expect(routeScrollKey(press(document.getElementById("b")!, "End"), main)).toBe(true);
    expect(main.scrollTop).toBe(2300);
  });

  it("leaves Space on a button, keys in the content or a field, and open dialogs alone", () => {
    const main = setup();
    expect(routeScrollKey(press(document.getElementById("b")!, " "), main)).toBe(false);
    expect(routeScrollKey(press(document.getElementById("i")!, "ArrowDown"), main)).toBe(false);
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog"></div>');
    expect(routeScrollKey(press(document.body, "PageDown"), main)).toBe(false);
    expect(main.scrollTop).toBe(0);
  });

  it("does nothing when the column is not a scroller (phone layout)", () => {
    const main = setup();
    main.style.overflowY = "visible";
    expect(routeScrollKey(press(document.body, "PageDown"), main)).toBe(false);
  });
});

describe("admin layout CSS (#458)", () => {
  const css = readFileSync(join(__dirname, "admin.css"), "utf-8");
  const desktop = css.slice(css.indexOf("@media (min-width: 701px)"));

  it("pins the desktop admin grid to the viewport with its own scrollers", () => {
    expect(desktop).toMatch(/\.admin-app \{[^}]*position: fixed;[^}]*inset: 0;/);
    expect(desktop).toMatch(/\.admin-nav,\s*\.admin-main \{[^}]*overflow-y: auto;/);
  });
});
