import { describe, expect, it } from "vitest";
import { NAV_LINKS, isActive } from "@/lib/nav";

describe("navegação principal", () => {
  it("ativa o link da própria página e de subpáginas", () => {
    expect(isActive("/produtos", "/produtos")).toBe(true);
    expect(isActive("/produtos/123", "/produtos")).toBe(true);
    expect(isActive("/lote/novo", "/lote")).toBe(true);
  });

  it("não confunde prefixos parecidos nem a página inicial", () => {
    expect(isActive("/produtos-extra", "/produtos")).toBe(false);
    expect(isActive("/", "/produtos")).toBe(false);
    expect(isActive("/historico", "/lote")).toBe(false);
  });

  it("todo link do menu aponta para uma rota única", () => {
    const hrefs = NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
