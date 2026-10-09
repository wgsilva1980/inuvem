import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { RevisaoConfigError } from "@/lib/images/review";
import type { Category, Product } from "@/lib/nuvemshop/types";
import type { StorePage } from "@/lib/nuvemshop/pages";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { criarGeradorItem, type GeradorItem } from "@/lib/seo/item-generate";
import { SeoItemError, aplicarSeoItem, aplicarSugestoes, gerarSeoItens, itensDeCategorias, itensDePaginas, sugestoesDe, type ItemApis } from "@/lib/seo/item";
import { PARTE_TITULO_MAX, SUFIXO_TITULO } from "@/lib/seo/text";
import { acaoLabel } from "@/lib/history/labels";

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = ((await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0] as { id: string }).id;
});

const cat = (id: number, nome: string, extra: Record<string, unknown> = {}): Category => ({ id, name: { pt: nome }, ...extra }) as unknown as Category;
const prod = (id: number, nome: string, cats: number[], published = true): Product =>
  ({ id, name: { pt: nome }, published, categories: cats.map((c) => ({ id: c, name: { pt: `C${c}` } })), variants: [], updated_at: "2026-10-01T10:00:00+0000" }) as unknown as Product;

const sugestaoFixa: GeradorItem = async (tipo, item) => ({ titulo: `${item.nome} | Donatelle Concept`, descricao: `Descrição de ${tipo} ${item.nome} para o Google.`, entrada: 10, saida: 5, avisos: [] });

describe("itens para o SEO", () => {
  it("categorias: contexto com pai, descrição, quantidade e exemplos só dos publicados", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos", { description: { pt: "<p>Peças leves</p>" }, seo_title: { pt: "Antigo" } }), cat(2, "Vestidos Longos", { parent: 1 })]);
    await upsertProducts(db, storeId, [prod(10, "Vestido Azul", [2]), prod(11, "Vestido Rosa", [2]), prod(12, "Vestido Oculto", [2], false)]);
    const itens = await itensDeCategorias(db, storeId);
    expect(itens.map((i) => i.nome)).toEqual(["Vestidos", "Vestidos Longos"]);
    expect(itens[0]).toMatchObject({ seoTituloAtual: "Antigo", seoDescricaoAtual: "" });
    expect(itens[0]!.linhas).toContain("Descrição atual da categoria: Peças leves");
    const longos = itens[1]!;
    expect(longos.linhas).toContain("Dentro da categoria: Vestidos");
    expect(longos.linhas).toContain("Produtos na categoria: 3");
    const exemplos = longos.linhas.find((l) => l.startsWith("Exemplos"))!;
    expect(exemplos).toContain("Vestido Azul");
    expect(exemplos).not.toContain("Oculto");
    expect(await itensDeCategorias(db, storeId, ["2"])).toHaveLength(1);
  });

  it("páginas: título, texto do conteúdo e SEO atual", () => {
    const paginas = [
      { id: 7, title: { pt: "Trocas" }, content: { pt: "<p>Troque em até <b>7 dias</b>.</p>" }, seo_title: { pt: "" } },
      { id: 3, title: { pt: "Sobre nós" }, content: { pt: "" } },
    ] as unknown as StorePage[];
    const itens = itensDePaginas(paginas);
    expect(itens.map((i) => i.nome)).toEqual(["Sobre nós", "Trocas"]);
    expect(itens[1]!.linhas[0]).toBe("Conteúdo da página: Troque em até 7 dias .");
    expect(itens[0]!.linhas[0]).toBe("Conteúdo da página: (vazio)");
    expect(itensDePaginas(paginas, ["7"])).toHaveLength(1);
  });
});

describe("gerar", () => {
  const item = (id: string) => ({ id, nome: `Item ${id}`, seoTituloAtual: "", seoDescricaoAtual: "", linhas: [] });

  it("guarda as sugestões e os erros por item, sem parar nos erros comuns", async () => {
    const gerador: GeradorItem = async (t, i) => {
      if (i.id === "2") throw new Error("falhou");
      return sugestaoFixa(t, i);
    };
    const r = await gerarSeoItens(db, { storeId, tipo: "categoria", itens: [item("1"), item("2"), item("3")], gerador });
    expect(r).toEqual({ geradas: 2, erros: 1 });
    const s = await sugestoesDe(db, storeId, "categoria");
    expect(s.get("1")!.titulo).toBe("Item 1 | Donatelle Concept");
    expect(s.get("2")!.erro).toBe("falhou");
    expect((await sugestoesDe(db, storeId, "pagina")).size).toBe(0); // separado por tipo
  });

  it("erro de configuração (chave da API) interrompe e é relançado", async () => {
    const gerador: GeradorItem = async () => {
      throw new RevisaoConfigError("sem chave");
    };
    await expect(gerarSeoItens(db, { storeId, tipo: "pagina", itens: [item("1"), item("2")], gerador })).rejects.toThrow(RevisaoConfigError);
  });

  it("o gerador real corrige o que passou do limite e monta o título com o sufixo", async () => {
    const respostas = [{ titulo_base: "T".repeat(80), descricao: "d".repeat(400) }, { titulo_base: "Vestidos Femininos", descricao: "Vestidos para todas as ocasiões. Confira na Donatelle Concept." }];
    const pedidos: Array<Record<string, any>> = [];
    const c = { beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: "text", text: JSON.stringify(respostas[pedidos.length - 1]) }] }) } } } as never;
    const r = await criarGeradorItem(c)("categoria", { id: "1", nome: "Vestidos", seoTituloAtual: "", seoDescricaoAtual: "", linhas: ["Produtos na categoria: 3"] });
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0]!.system).toContain("CATEGORIAS");
    expect(pedidos[1]!.messages[0].content.at(-1).text).toContain("foi recusada");
    expect(r.titulo).toBe(`Vestidos Femininos${SUFIXO_TITULO}`);
    expect(r.entrada).toBe(200);
    const pagina = await criarGeradorItem({ beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(respostas[1]) }] }) } } } as never)("pagina", { id: "2", nome: "Trocas", seoTituloAtual: "", seoDescricaoAtual: "", linhas: [] });
    expect(pedidos.at(-1)!.system).toContain("PÁGINAS");
    expect(pagina.titulo.length).toBeLessThanOrEqual(PARTE_TITULO_MAX + SUFIXO_TITULO.length);
  });
});

class LojaFake implements ItemApis {
  cats = new Map<number, Category>();
  paginas = new Map<number, StorePage>();
  chamadas: string[] = [];
  categoria = {
    get: async (id: number) => structuredClone(this.cats.get(id)!),
    update: async (id: number, input: Record<string, unknown>) => {
      this.chamadas.push(`cat ${id} ${JSON.stringify(input)}`);
      const c = this.cats.get(id)!;
      Object.assign(c, input);
      return structuredClone(c);
    },
  };
  pagina = {
    get: async (id: number) => structuredClone(this.paginas.get(id)!),
    update: async (id: number, input: Record<string, unknown>) => {
      this.chamadas.push(`pag ${id} ${JSON.stringify(input)}`);
      if (id === 99) throw new NuvemshopError("403", 403, null);
      const p = this.paginas.get(id)!;
      Object.assign(p, input);
      return structuredClone(p);
    },
  };
}

describe("gravar na loja", () => {
  it("categoria: grava só o SEO, atualiza o espelho, registra no Histórico e guarda o que foi enviado", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos")]);
    const loja = new LojaFake();
    loja.cats.set(1, cat(1, "Vestidos"));
    const r = await aplicarSeoItem(db, loja, { storeId, actor, tipo: "categoria", id: 1, titulo: "Vestidos Femininos | Donatelle Concept", descricao: "Vestidos para todas as ocasiões." });
    expect(r.changed).toBe(true);
    expect(loja.chamadas).toEqual(['cat 1 {"seo_title":{"pt":"Vestidos Femininos | Donatelle Concept"},"seo_description":{"pt":"Vestidos para todas as ocasiões."}}']);
    const [espelho] = (await pg.query<{ t: string }>("SELECT raw_json->'seo_title'->>'pt' AS t FROM categories WHERE id = 1")).rows;
    expect(espelho!.t).toBe("Vestidos Femininos | Donatelle Concept");
    const [log] = (await pg.query<{ acao: string; entidade: string; antes: Record<string, string>; sucesso: boolean }>("SELECT acao, entidade, antes, sucesso FROM audit_log")).rows;
    expect(log).toMatchObject({ acao: "categoria.seo", entidade: "categoria", sucesso: true });
    expect(log!.antes).toEqual({ seo_title: "", seo_description: "" });
    expect((await sugestoesDe(db, storeId, "categoria")).get("1")!.aplicado).toBe(true);
    // repetir não escreve de novo
    expect((await aplicarSeoItem(db, loja, { storeId, actor, tipo: "categoria", id: 1, titulo: "Vestidos Femininos | Donatelle Concept", descricao: "Vestidos para todas as ocasiões." })).changed).toBe(false);
    expect(loja.chamadas).toHaveLength(1);
  });

  it("categoria alterada por fora: atualiza o espelho e recusa", async () => {
    await upsertCategories(db, storeId, [cat(1, "Vestidos")]);
    const loja = new LojaFake();
    loja.cats.set(1, cat(1, "Vestidos", { seo_title: { pt: "Mudou na loja" } }));
    await expect(aplicarSeoItem(db, loja, { storeId, actor, tipo: "categoria", id: 1, titulo: "Novo | Donatelle Concept", descricao: "Texto." })).rejects.toThrow(/alterada na Nuvemshop/);
    expect(loja.chamadas).toHaveLength(0);
    expect((await pg.query<{ t: string }>("SELECT raw_json->'seo_title'->>'pt' AS t FROM categories WHERE id = 1")).rows[0]!.t).toBe("Mudou na loja");
  });

  it("valida vazio e limites antes de falar com a loja", async () => {
    const loja = new LojaFake();
    const base = { storeId, actor, tipo: "pagina" as const, id: 1 };
    await expect(aplicarSeoItem(db, loja, { ...base, titulo: " ", descricao: "x" })).rejects.toThrow(SeoItemError);
    await expect(aplicarSeoItem(db, loja, { ...base, titulo: "x", descricao: "" })).rejects.toThrow(/descrição/);
    await expect(aplicarSeoItem(db, loja, { ...base, titulo: "x".repeat(71), descricao: "x" })).rejects.toThrow(/máximo é 70/);
    await expect(aplicarSeoItem(db, loja, { ...base, titulo: "x", descricao: "x".repeat(321) })).rejects.toThrow(/máximo é 320/);
    expect(loja.chamadas).toHaveLength(0);
  });

  it("página: lê o SEO atual da loja para o Histórico e grava", async () => {
    const loja = new LojaFake();
    loja.paginas.set(7, { id: 7, title: { pt: "Trocas" }, seo_title: { pt: "Velho" } } as unknown as StorePage);
    await aplicarSeoItem(db, loja, { storeId, actor, tipo: "pagina", id: 7, titulo: "Trocas e Devoluções | Donatelle Concept", descricao: "Como trocar." });
    const [log] = (await pg.query<{ acao: string; antes: Record<string, string> }>("SELECT acao, antes FROM audit_log")).rows;
    expect(log).toMatchObject({ acao: "pagina.seo", antes: { seo_title: "Velho", seo_description: "" } });
    expect(acaoLabel("pagina.seo")).toBe("SEO da página gravado");
    expect(acaoLabel("categoria.seo")).toBe("SEO da categoria gravado");
  });

  it("em lote: modo 'vazios' pula quem já tem SEO; sem sugestão e erro de permissão são reportados", async () => {
    await upsertCategories(db, storeId, [cat(1, "A"), cat(2, "B"), cat(3, "C")]);
    const loja = new LojaFake();
    for (const id of [1, 2, 3]) loja.cats.set(id, cat(id, ["A", "B", "C"][id - 1]!));
    await gerarSeoItens(db, { storeId, tipo: "categoria", itens: [1, 2].map((i) => ({ id: String(i), nome: `C${i}`, seoTituloAtual: "", seoDescricaoAtual: "", linhas: [] })), gerador: sugestaoFixa });
    const atuais = new Map([["1", { titulo: "", descricao: "" }], ["2", { titulo: "Já tem", descricao: "" }], ["3", { titulo: "", descricao: "" }]]);
    const r = await aplicarSugestoes(db, loja, { storeId, actor, tipo: "categoria", ids: ["1", "2", "3"], modo: "vazios", atuais });
    expect(r).toEqual([{ id: "1", ok: true }, { id: "2", ok: true, pulado: true }, { id: "3", ok: false, pulado: true, erro: "Sem sugestão gerada." }]);
    expect(loja.chamadas).toHaveLength(1);

    const todos = await aplicarSugestoes(db, loja, { storeId, actor, tipo: "categoria", ids: ["2"], modo: "todos", atuais });
    expect(todos[0]).toEqual({ id: "2", ok: true });

    loja.paginas.set(99, { id: 99, title: { pt: "X" } } as unknown as StorePage);
    loja.paginas.set(98, { id: 98, title: { pt: "Y" } } as unknown as StorePage);
    await gerarSeoItens(db, { storeId, tipo: "pagina", itens: ["99", "98"].map((i) => ({ id: i, nome: i, seoTituloAtual: "", seoDescricaoAtual: "", linhas: [] })), gerador: sugestaoFixa });
    const semPermissao = await aplicarSugestoes(db, loja, { storeId, actor, tipo: "pagina", ids: ["99", "98"], modo: "todos", atuais: new Map() });
    expect(semPermissao).toHaveLength(1); // parou no 403
    expect(semPermissao[0]).toMatchObject({ id: "99", ok: false });
  });
});
