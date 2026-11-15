import { afterEach, describe, expect, it } from "vitest";
import { syncThemeColor } from "./themeColor";

describe("syncThemeColor (#432)", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("style");
  });

  it("writes the page background into the active theme-color meta only", () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#111" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#222" media="(prefers-color-scheme: dark)">';
    document.documentElement.style.backgroundColor = "rgb(255, 255, 255)";
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {} })) as never;
    syncThemeColor();
    const [light, dark] = [...document.querySelectorAll<HTMLMetaElement>("meta")];
    expect(light.content).toBe("#ffffff");
    expect(dark.content).toBe("#222");
  });

  it("re-inserts the active meta so Safari re-reads it", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#111" media="(prefers-color-scheme: dark)">';
    const meta = document.querySelector("meta") as HTMLMetaElement;
    document.documentElement.style.backgroundColor = "rgb(0, 0, 0)";
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {} })) as never;
    syncThemeColor();
    expect(meta.content).toBe("#000000");
    expect(meta.isConnected).toBe(true);
  });
});
