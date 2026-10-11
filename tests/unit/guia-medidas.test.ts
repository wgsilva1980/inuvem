import { describe, expect, it } from "vitest";
import { lerTabela, montarGuia } from "@/lib/content/medidas";

const BASE = "Tamanho;Busto;Cintura;Quadril\nP;84;66;92\nM;88;70;96\nG;92;74;100";

describe("lerTabela", () => {
  it("lê ponto e vírgula, tab (planilha) e barra", () => {
    const esperado = { colunas: ["Busto", "Cintura", "Quadril"], linhas: [{ tamanho: "P", valores: ["84", "66", "92"] }, { tamanho: "M", valores: ["88", "70", "96"] }, { tamanho: "G", valores: ["92", "74", "100"] }] };
    expect(lerTabela(BASE).tabela).toEqual(esperado);
    expect(lerTabela(BASE.replace(/;/g, "\t")).tabela).toEqual(esperado);
    expect(lerTabela(BASE.replace(/;/g, " | ")).tabela).toEqual(esperado);
  });

  it("aceita decimal com vírgula e faixa, normalizando o hífen", () => {
    expect(lerTabela("Tam;Busto\nP;84,5\nM;88 - 90").tabela!.linhas.map((l) => l.valores[0])).toEqual(["84,5", "88–90"]);
  });

  it("aponta cada problema com a linha", () => {
    const r = lerTabela("Tam;Busto;Cintura\nP;84\nM;abc;70\nM;90;72");
    expect(r.tabela).toBeNull();
    expect(r.erros).toEqual([
      "Linha 2 (P): esperava 2 medida(s) e encontrei 1.",
      "Linha 3 (M), Busto: “abc” não é um número (use 86, 86,5 ou uma faixa como 86-90).",
      "Linha 4: o tamanho M aparece duas vezes.",
    ]);
  });

  it("exige título e ao menos um tamanho; limita tamanhos e colunas", () => {
    expect(lerTabela("Tam;Busto").erros).toHaveLength(1);
    expect(lerTabela("só uma coluna\nP").erros[0]).toMatch(/primeira linha/);
    const muitos = ["Tam;Busto", ...Array.from({ length: 13 }, (_, i) => `T${i};${80 + i}`)].join("\n");
    expect(lerTabela(muitos).erros[0]).toMatch(/No máximo 12/);
    expect(lerTabela(`Tam;${Array.from({ length: 9 }, (_, i) => `M${i}`).join(";")}\nP;${Array(9).fill("1").join(";")}`).erros[0]).toMatch(/No máximo 8/);
  });
});

describe("montarGuia", () => {
  it("monta tabela com os números digitados e o como medir só das partes reconhecidas", () => {
    const g = montarGuia("Tamanho;Busto;Comprimento;Cor do tecido\nP;84;90;1\nM;88;92;2".replace("Cor do tecido", "Gancho"), { tipo: "corpo", comoMedir: true });
    expect(g.erros).toEqual([]);
    expect(g.html).toContain("<th>Busto</th>");
    expect(g.html).toContain("<td>84</td>");
    expect(g.html).toContain("do corpo, em centímetros");
    expect(g.html).toContain("<strong>Busto:</strong>");
    expect(g.html).toContain("<strong>Comprimento:</strong>");
    expect(g.html).not.toContain("Cintura");
    expect(g.html).not.toContain("Quadril:");
  });

  it("medidas da peça mudam a nota e dá para omitir o como medir", () => {
    const g = montarGuia(BASE, { tipo: "peca", comoMedir: false });
    expect(g.html).toContain("da peça");
    expect(g.html).not.toContain("Como medir");
  });

  it("escapa HTML nos títulos e tamanhos (nada é executado)", () => {
    const g = montarGuia("Tam;<script>x</script>\nP;84", { tipo: "corpo", comoMedir: false });
    expect(g.html).not.toContain("<script");
    const h = montarGuia("Tam;Busto\n<b>P</b>;84", { tipo: "corpo", comoMedir: false });
    expect(h.html).toContain("&lt;b&gt;P&lt;/b&gt;");
  });

  it("avisa quando uma medida diminui de um tamanho para o seguinte", () => {
    const g = montarGuia("Tam;Busto\nP;88\nM;84\nG;92", { tipo: "corpo", comoMedir: false });
    expect(g.avisos).toEqual(["Busto: diminui de P (88) para M (84). Confira se os tamanhos estão do menor para o maior."]);
    expect(montarGuia(BASE, { tipo: "corpo", comoMedir: false }).avisos).toEqual([]);
  });

  it("erros não geram HTML", () => {
    expect(montarGuia("x", { tipo: "corpo", comoMedir: true })).toMatchObject({ html: "", erros: [expect.any(String)] });
  });
});
