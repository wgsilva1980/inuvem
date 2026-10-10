import { describe, expect, it } from "vitest";
import { ADMIN_LINKS, NAV_LINKS, isActive } from "@/lib/nav";

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
    const hrefs = [...NAV_LINKS, ...ADMIN_LINKS].map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("agrupa as páginas administrativas no submenu", () => {
    expect(ADMIN_LINKS.map((l) => l.label)).toEqual(["Promoções", "Cupons", "Vendas", "Custos", "Estoque", "Qualidade", "Carrinhos", "Expedição", "Reativação", "Imagens", "SEO", "Conteúdo", "E-mails", "Selos", "Lotes", "Histórico", "Automações", "Resumo diário", "Diagnóstico", "Usuários"]);
  });
});

describe("menu principal enxuto", () => {
  it("mantém só o essencial na barra e o resto em Administração", () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual(["Produtos", "Categorias", "Contatos", "Cashback"]);
  });

  it("as telas movidas continuam acessíveis e destacam o menu Administração", () => {
    const admin = ADMIN_LINKS.map((l) => l.href);
    for (const href of ["/promocoes", "/cupons", "/vendas", "/custos", "/estoque", "/carrinhos", "/expedicao"]) expect(admin).toContain(href);
    expect(ADMIN_LINKS.some((l) => isActive("/promocoes/liquidar", l.href))).toBe(true);
  });
});
