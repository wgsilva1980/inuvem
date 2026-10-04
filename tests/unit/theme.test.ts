import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_KEY, nextTheme, parseTheme } from "@/lib/theme";
import { acaoGrupo } from "@/lib/history/labels";

describe("tema", () => {
  it("alterna automático → claro → escuro → automático", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("valor salvo desconhecido cai no automático", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("roxo")).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });

  it("o script inicial aplica só 'light' e 'dark' e não quebra sem armazenamento", () => {
    const run = (stored: string | null, throws = false) => {
      const attrs: Record<string, string> = {};
      const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      const ls = { getItem: (k: string) => { if (throws) throw new Error("bloqueado"); return k === THEME_KEY ? stored : null; } };
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(ls, doc);
      return attrs;
    };
    expect(run("dark")).toEqual({ "data-theme": "dark" });
    expect(run("light")).toEqual({ "data-theme": "light" });
    expect(run("qualquer")).toEqual({});
    expect(run(null)).toEqual({});
    expect(run("dark", true)).toEqual({});
  });
});

describe("acaoGrupo (ícone do histórico)", () => {
  it("usa o prefixo do código da ação", () => {
    expect(acaoGrupo("produto.atualizar")).toBe("produto");
    expect(acaoGrupo("variante.atualizar")).toBe("variante");
    expect(acaoGrupo("imagem.enviar")).toBe("imagem");
    expect(acaoGrupo("categoria.criar")).toBe("categoria");
    expect(acaoGrupo("lote.preco")).toBe("lote");
    expect(acaoGrupo("webhook.receber")).toBe("outro");
  });
});
