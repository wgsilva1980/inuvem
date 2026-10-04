import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

type Tokens = Record<string, string>;

function block(selectorStart: string): Tokens {
  const start = css.indexOf(selectorStart);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const light: Tokens = block(":root {");
const dark: Tokens = block("@media (prefers-color-scheme: dark)");

describe.each([
  ["claro", light],
  ["escuro", dark],
])("contraste das cores no tema %s", (_name, tokens) => {
  const t = (name: string) => tokens[name] ?? "#000000";
  for (const surface of ["background", "card"]) {
    for (const fg of ["foreground", "muted", "success", "danger", "warning", "primary"]) {
      it(`${fg} sobre ${surface} passa em AA (4,5:1)`, () => {
        expect(contrast(t(fg), t(surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it("texto do botão primário passa em AA", () => {
    expect(contrast(t("primary-foreground"), t("primary"))).toBeGreaterThanOrEqual(4.5);
  });
  it("borda dos campos passa em 3:1 (componente de interface)", () => {
    expect(contrast(t("border-strong"), t("card"))).toBeGreaterThanOrEqual(3);
  });
});
