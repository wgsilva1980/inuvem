import { describe, expect, it } from "vitest";
import { activeFilters, catalogParamsSchema } from "@/lib/catalog/params";

const parse = (o: Record<string, string>) => catalogParamsSchema.parse(o);

describe("activeFilters (chips de filtros ativos)", () => {
  it("não mostra nada sem filtros", () => {
    expect(activeFilters(parse({}))).toEqual([]);
    expect(activeFilters(parse({ status: "todos", ordem: "nome" }))).toEqual([]);
  });

  it("descreve cada filtro e o link que remove só ele", () => {
    const chips = activeFilters(parse({ q: "vestido", status: "publicados", categoria: "10", sem_imagem: "1" }), (id) => (id === 10 ? "Vestidos" : undefined));
    expect(chips.map((c) => c.label)).toEqual(["Busca: vestido", "Publicados", "Categoria: Vestidos", "Sem imagem"]);
    const semBusca = new URLSearchParams(chips[0]!.removeQuery);
    expect(semBusca.get("q")).toBeNull();
    expect(semBusca.get("status")).toBe("publicados");
    expect(semBusca.get("categoria")).toBe("10");
    expect(semBusca.get("sem_imagem")).toBe("1");
  });

  it("remover o último filtro deixa a query vazia e mantém a ordenação", () => {
    const [chip] = activeFilters(parse({ sem_sku: "1", ordem: "atualizados" }));
    expect(chip?.label).toBe("Variante sem SKU");
    expect(chip?.removeQuery).toBe("ordem=atualizados");
    const [so] = activeFilters(parse({ sem_sku: "1" }));
    expect(so?.removeQuery).toBe("");
  });

  it("nunca carrega a página: remover filtro volta para a primeira página", () => {
    const [chip] = activeFilters(parse({ q: "x", pagina: "4" }));
    expect(new URLSearchParams(chip!.removeQuery).get("pagina")).toBeNull();
  });
});
