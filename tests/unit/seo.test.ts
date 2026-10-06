import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import sharp from "sharp";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { RevisaoConfigError } from "@/lib/images/review";
import { criarGeradorSeo, type GeradorSeo } from "@/lib/seo/generate";
import { SeoInvalidoError, aplicarSeo, aplicarSeoPendentes, contarParaAplicar, gerarSeoPendentes, listarSeo, produtosParaSeo, resumoSeo } from "@/lib/seo/repo";
import { DESCRICAO_MAX, PARTE_TITULO_MAX, SUFIXO_TITULO, TITULO_MAX, ajustarDescricao, cortarEmPalavra, montarTitulo, textoDaDescricao } from "@/lib/seo/text";
import type { ProductApi } from "@/lib/catalog/update";
import type { Product, ProductInput } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;
let jpeg: Buffer;

const produto = (id: number, nome: string, extra: Partial<Product> = {}): Product =>
  ({
    id,
    name: { pt: nome },
    description: { pt: `<p>${nome} em <strong>tecido leve</strong>.</p>` },
    published: true,
    categories: [{ id: 5, name: { pt: "Saias" } }],
    attributes: [{ pt: "Cor" }],
    variants: [{ id: id * 10, product_id: id, price: "10.00", stock_management: false, values: [{ pt: "Azul" }] }],
    images: [{ id: id * 100 + 2, product_id: id, src: `https://x/${id}-b.jpg`, position: 2 }, { id: id * 100 + 1, product_id: id, src: `https://x/${id}-a.jpg`, position: 1 }],
    seo_title: { pt: "" },
    seo_description: { pt: "" },
    updated_at: "2026-10-01T10:00:00+0000",
    ...extra,
  }) as unknown as Product;

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
  jpeg = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#88aacc" } }).jpeg().toBuffer();
});

const baixar = async () => jpeg;
const gerador: GeradorSeo & { chamadas: Array<{ produto: string; comFoto: boolean }> } = Object.assign(
  async (foto: unknown, ctx: { produto: string }) => {
    gerador.chamadas.push({ produto: ctx.produto, comFoto: foto !== null });
    return { titulo: montarTitulo(ctx.produto), descricao: `${ctx.produto} com caimento leve. Confira na Donatelle Concept.`, entrada: 1500, saida: 120, avisos: [] };
  },
  { chamadas: [] as Array<{ produto: string; comFoto: boolean }> },
);
beforeEach(() => {
  gerador.chamadas.length = 0;
});

describe("texto do SEO", () => {
  it("o título leva o nome da loja e nunca passa de 70 caracteres", () => {
    expect(PARTE_TITULO_MAX).toBe(TITULO_MAX - SUFIXO_TITULO.length);
    expect(montarTitulo("Saia Midi com Fenda Azul")).toBe("Saia Midi com Fenda Azul | Donatelle Concept");
    const longo = montarTitulo("Vestido Longo Estampado Floral com Decote em V e Mangas Bufantes Verão");
    expect(longo.length).toBeLessThanOrEqual(TITULO_MAX);
    expect(longo.endsWith(SUFIXO_TITULO)).toBe(true);
    expect(longo).not.toMatch(/\s\|\s*\|/);
  });

  it("não repete o nome da loja se o modelo já o colocou", () => {
    expect(montarTitulo("Blusa Regata Laço | Donatelle Concept")).toBe("Blusa Regata Laço | Donatelle Concept");
  });

  it("corta em palavra inteira, sem pontuação solta", () => {
    expect(cortarEmPalavra("Saia midi azul de cintura alta, com fenda", 30)).toBe("Saia midi azul de cintura alta");
    expect(cortarEmPalavra("curto", 30)).toBe("curto");
  });

  it("descrição acima de 320 termina na última frase completa", () => {
    const frase = "Saia midi azul com caimento leve e fenda frontal. ";
    const d = ajustarDescricao(frase.repeat(10));
    expect(d.length).toBeLessThanOrEqual(DESCRICAO_MAX);
    expect(d.endsWith(".")).toBe(true);
  });

  it("transforma o HTML da descrição em texto", () => {
    expect(textoDaDescricao("<p>Saia&nbsp;midi</p><ul><li>Azul</li></ul><script>x()</script>")).toBe("Saia midi Azul");
  });
});

describe("gerador (Claude)", () => {
  const ctx = { produto: "Saia", categorias: [], variacoes: [], descricaoAtual: "", seoTituloAtual: "", seoDescricaoAtual: "" };
  const cliente = (respostas: Array<{ titulo_base: string; descricao: string }>) => {
    const pedidos: Array<Record<string, any>> = [];
    const c = { beta: { messages: { create: async (p: Record<string, any>) => (pedidos.push(p), { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 80 }, content: [{ type: "text", text: JSON.stringify(respostas[Math.min(pedidos.length, respostas.length) - 1]) }] }) } } } as never;
    return { c, pedidos };
  };

  it("monta o título com o nome da loja e manda os dados do produto, a foto e o esforço baixo", async () => {
    const { c, pedidos } = cliente([{ titulo_base: "Saia Midi com Fenda Azul", descricao: "Saia midi azul de cintura alta com fenda frontal. Confira na Donatelle Concept." }]);
    const r = await criarGeradorSeo(c)({ bytes: Buffer.from("x"), mediaType: "image/jpeg" }, { ...ctx, produto: "Saia Midi", variacoes: ["Azul / P"], descricaoAtual: "tecido leve" });
    expect(r.titulo).toBe("Saia Midi com Fenda Azul | Donatelle Concept");
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.model).toBe("claude-opus-5-5");
    expect(pedidos[0]!.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    const conteudo = pedidos[0]!.messages[0].content;
    expect(conteudo[0]).toMatchObject({ type: "image" });
    expect(conteudo[1].text).toContain("Saia Midi");
    expect(conteudo[1].text).toContain("Azul / P");
    expect(conteudo[1].text).toContain("tecido leve");
    expect(String(pedidos[0]!.system)).toContain("nunca cite modelo");
  });

  it("sem foto, manda só o texto", async () => {
    const { c, pedidos } = cliente([{ titulo_base: "Saia Azul", descricao: "Saia azul leve. Confira na Donatelle Concept." }]);
    await criarGeradorSeo(c)(null, ctx);
    expect(pedidos[0]!.messages[0].content).toHaveLength(1);
  });

  it("repete uma vez quando o texto cita a modelo, e soma os tokens", async () => {
    const { c, pedidos } = cliente([
      { titulo_base: "Saia Azul", descricao: "Modelo veste saia azul de cintura alta com fenda frontal." },
      { titulo_base: "Saia Azul", descricao: "Saia azul de cintura alta com fenda frontal. Confira na Donatelle Concept." },
    ]);
    const r = await criarGeradorSeo(c)(null, ctx);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.messages[0].content.at(-1).text).toContain("citava a modelo");
    expect(r.descricao).toBe("Saia azul de cintura alta com fenda frontal. Confira na Donatelle Concept.");
    expect(r).toMatchObject({ entrada: 2000, saida: 160, avisos: [] });
  });

  it("repete quando o título ou a descrição passam do limite; se ainda passar, corta no limite", async () => {
    const longo = { titulo_base: "Vestido Longo Estampado Floral com Decote em V e Mangas Bufantes de Verão", descricao: "Vestido longo estampado. ".repeat(20) };
    const { c, pedidos } = cliente([longo]);
    const r = await criarGeradorSeo(c)(null, ctx);
    expect(pedidos).toHaveLength(2);
    expect(r.titulo.length).toBeLessThanOrEqual(TITULO_MAX);
    expect(r.descricao.length).toBeLessThanOrEqual(DESCRICAO_MAX);
  });

  it("avisa quando o texto ainda cita preço depois da nova tentativa", async () => {
    const { c } = cliente([{ titulo_base: "Saia Azul", descricao: "Saia azul por apenas R$ 99. Confira." }]);
    const r = await criarGeradorSeo(c)(null, ctx);
    expect(r.avisos.join(" ")).toContain("preço");
  });

  it("recusa do Claude vira erro do produto", async () => {
    const c = { beta: { messages: { create: async () => ({ stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) } } } as never;
    await expect(criarGeradorSeo(c)(null, ctx)).rejects.toThrow("recusou");
  });
});

describe("geração em lote", () => {
  it("gera para todos os produtos (inclusive os que já têm SEO), usando a foto principal, e termina", async () => {
    await upsertProducts(db, storeId, [produto(1, "Saia Midi"), produto(2, "Blusa", { seo_title: { pt: "Título velho" }, seo_description: { pt: "Descrição velha" } } as never)]);
    const r = await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar });
    expect(r).toMatchObject({ geradas: 2, erros: 0, restantes: false });
    expect(gerador.chamadas.map((c) => c.produto).sort()).toEqual(["Blusa", "Saia Midi"]);
    expect(gerador.chamadas.every((c) => c.comFoto)).toBe(true);
    const res = await resumoSeo(db, storeId);
    expect(res).toMatchObject({ produtos: 2, geradas: 2, aplicadas: 0, semSeo: 1, entrada: 3000, saida: 240 });
    expect(await produtosParaSeo(db, storeId, 10)).toEqual([]);
  });

  it("a foto usada é a de menor posição; sem foto baixada, gera só com o texto", async () => {
    await upsertProducts(db, storeId, [produto(1, "Saia")]);
    const [p] = await produtosParaSeo(db, storeId, 10);
    expect(p!.foto).toBe("https://x/1-a.jpg");
    await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar: async () => { throw new Error("403"); } });
    expect(gerador.chamadas).toEqual([{ produto: "Saia", comFoto: false }]);
  });

  it("respeita maxProdutos e continua depois", async () => {
    await upsertProducts(db, storeId, [1, 2, 3, 4, 5].map((n) => produto(n, `P${n}`)));
    const r1 = await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar, maxProdutos: 2 });
    expect(r1).toMatchObject({ geradas: 2, restantes: true });
    const r2 = await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar });
    expect(r2).toMatchObject({ geradas: 3, restantes: false });
  });

  it("erro num produto não trava os outros; o erro recente não se repete, o antigo sim", async () => {
    await upsertProducts(db, storeId, [produto(1, "Ruim"), produto(2, "Boa")]);
    const g: GeradorSeo = async (f, ctx) => (ctx.produto === "Ruim" ? Promise.reject(new Error("falhou")) : gerador(f, ctx));
    const r = await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador: g, baixar });
    expect(r).toMatchObject({ geradas: 1, erros: 1, restantes: false });
    expect(await produtosParaSeo(db, storeId, 10)).toEqual([]);
    await pg.query("UPDATE seo_suggestion SET generated_at = now() - interval '1 hour'");
    expect((await produtosParaSeo(db, storeId, 10)).map((p) => p.produto)).toEqual(["Ruim"]);
  });

  it("problema de configuração (chave) interrompe e propaga", async () => {
    await upsertProducts(db, storeId, [produto(1, "Saia")]);
    await expect(gerarSeoPendentes(db, { storeId, budgetMs: 10_000, baixar, gerador: async () => { throw new RevisaoConfigError("chave inválida"); } })).rejects.toThrow("chave inválida");
    expect((await pg.query("SELECT 1 FROM seo_suggestion")).rows).toHaveLength(0);
  });
});

/** Loja falsa: guarda o produto e aplica o PUT. */
function loja(inicial: Product[]) {
  const produtos = new Map(inicial.map((p) => [p.id, structuredClone(p)]));
  const puts: Array<{ id: number; input: ProductInput }> = [];
  const api: ProductApi = {
    async get(id) {
      return structuredClone(produtos.get(id)!);
    },
    async put(id, input) {
      puts.push({ id, input });
      const p = produtos.get(id)!;
      if (input.seo_title) (p as unknown as Record<string, unknown>).seo_title = input.seo_title;
      if (input.seo_description) (p as unknown as Record<string, unknown>).seo_description = input.seo_description;
      return structuredClone(p);
    },
  };
  return { api, puts, produtos };
}

describe("gravar na loja", () => {
  it("grava só título e descrição, atualiza o espelho, o Histórico e a sugestão", async () => {
    const p = produto(1, "Saia Midi");
    await upsertProducts(db, storeId, [p]);
    const l = loja([p]);
    const r = await aplicarSeo(db, l.api, { storeId, actor: "a@b.c", productId: 1, titulo: "Saia Midi Azul | Donatelle Concept", descricao: "Saia midi azul com fenda. Confira na Donatelle Concept." });
    expect(r.changed).toBe(true);
    expect(l.puts).toHaveLength(1);
    expect(Object.keys(l.puts[0]!.input).sort()).toEqual(["seo_description", "seo_title"]);
    const [linha] = await listarSeo(db, storeId);
    expect(linha).toMatchObject({ seo_titulo: "Saia Midi Azul | Donatelle Concept", aplicado: true, igual: true });
    const log = await pg.query<{ acao: string; sucesso: boolean; antes: Record<string, string> }>("SELECT acao, sucesso, antes FROM audit_log");
    expect(log.rows).toEqual([{ acao: "produto.atualizar", sucesso: true, antes: { seo_title: "", seo_description: "" } }]);
  });

  it("recusa texto vazio ou acima dos limites, sem tocar na loja", async () => {
    const p = produto(1, "Saia");
    await upsertProducts(db, storeId, [p]);
    const l = loja([p]);
    const base = { storeId, actor: "a@b.c", productId: 1 };
    await expect(aplicarSeo(db, l.api, { ...base, titulo: "  ", descricao: "x" })).rejects.toBeInstanceOf(SeoInvalidoError);
    await expect(aplicarSeo(db, l.api, { ...base, titulo: "x".repeat(71), descricao: "x" })).rejects.toThrow("máximo é 70");
    await expect(aplicarSeo(db, l.api, { ...base, titulo: "x", descricao: "x".repeat(321) })).rejects.toThrow("máximo é 320");
    expect(l.puts).toHaveLength(0);
  });

  it("em lote: 'vazios' não mexe em quem já tem SEO; 'todos' substitui; retomável", async () => {
    const vazio = produto(1, "Saia");
    const comSeo = produto(2, "Blusa", { seo_title: { pt: "Título velho" }, seo_description: { pt: "Descrição velha" } } as never);
    await upsertProducts(db, storeId, [vazio, comSeo]);
    await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar });
    const l = loja([vazio, comSeo]);
    expect(await contarParaAplicar(db, storeId)).toEqual({ vazios: 1, todos: 2 });

    const r1 = await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 10_000, modo: "vazios" });
    expect(r1).toMatchObject({ aplicados: 1, falhas: [], restantes: false });
    expect(l.puts.map((x) => x.id)).toEqual([1]);

    const r2 = await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 10_000, modo: "todos" });
    expect(r2.aplicados).toBe(1);
    expect(l.puts.map((x) => x.id)).toEqual([1, 2]);
    expect((await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 10_000, modo: "todos" })).aplicados).toBe(0);
    expect(await contarParaAplicar(db, storeId)).toEqual({ vazios: 0, todos: 0 });
  });

  it("falha num produto é registrada e o resto segue; para cedo se tudo falhar", async () => {
    const produtos = [1, 2, 3, 4, 5, 6].map((n) => produto(n, `P${n}`));
    await upsertProducts(db, storeId, produtos);
    await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar });
    const l = loja(produtos);
    l.api.put = async () => {
      throw new Error("loja fora do ar");
    };
    const r = await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 10_000, modo: "vazios" });
    expect(r.aplicados).toBe(0);
    expect(r.falhas).toHaveLength(5);
    expect(r.falhas[0]!.mensagem).toBe("loja fora do ar");
  });

  it("para no orçamento de tempo", async () => {
    const produtos = [1, 2, 3, 4].map((n) => produto(n, `P${n}`));
    await upsertProducts(db, storeId, produtos);
    await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar });
    const l = loja(produtos);
    let t = 0;
    const r = await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 150, modo: "vazios", now: () => (t += 100) });
    expect(r.restantes).toBe(true);
    expect(r.aplicados).toBeGreaterThan(0);
    expect(r.aplicados).toBeLessThan(4);
  });
});


describe("filtro de produtos (publicados e com estoque)", () => {
  const variante = (id: number, over: Record<string, unknown>) => [{ id: id * 10, product_id: id, price: "10.00", stock_management: false, values: [{ pt: "Azul" }], ...over }];
  const catalogo = () => [
    produto(1, "Publicado com estoque", { variants: variante(1, { stock_management: true, stock: 3 }) as never }),
    produto(2, "Publicado estoque ilimitado", { variants: variante(2, { stock_management: false }) as never }),
    produto(3, "Publicado sem estoque", { variants: variante(3, { stock_management: true, stock: 0 }) as never }),
    produto(4, "Rascunho com estoque", { published: false, variants: variante(4, { stock_management: true, stock: 5 }) as never }),
  ];
  const nomes = async (f: { publicados: boolean; comEstoque: boolean }) => (await produtosParaSeo(db, storeId, 10, [], f)).map((p) => p.produto).sort();

  it("sem filtro entram todos; só publicados tira o rascunho; com estoque tira os esgotados", async () => {
    await upsertProducts(db, storeId, catalogo());
    expect(await nomes({ publicados: false, comEstoque: false })).toHaveLength(4);
    expect(await nomes({ publicados: true, comEstoque: false })).toEqual(["Publicado com estoque", "Publicado estoque ilimitado", "Publicado sem estoque"]);
    expect(await nomes({ publicados: false, comEstoque: true })).toEqual(["Publicado com estoque", "Publicado estoque ilimitado", "Rascunho com estoque"]);
    expect(await nomes({ publicados: true, comEstoque: true })).toEqual(["Publicado com estoque", "Publicado estoque ilimitado"]);
  });

  it("gerar só gera para quem passa no filtro; os outros não são tocados", async () => {
    await upsertProducts(db, storeId, catalogo());
    const filtro = { publicados: true, comEstoque: true };
    const r = await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar, filtro });
    expect(r).toMatchObject({ geradas: 2, restantes: false });
    expect(gerador.chamadas.map((c) => c.produto).sort()).toEqual(["Publicado com estoque", "Publicado estoque ilimitado"]);
    expect((await pg.query("SELECT count(*)::int AS n FROM seo_suggestion")).rows[0]).toEqual({ n: 2 });
    expect(await resumoSeo(db, storeId, filtro)).toMatchObject({ produtos: 2, geradas: 2 });
    expect(await resumoSeo(db, storeId)).toMatchObject({ produtos: 4, geradas: 2 }); // sem filtro, ainda faltam 2
    expect((await listarSeo(db, storeId, filtro)).map((l) => l.produto)).toEqual(["Publicado com estoque", "Publicado estoque ilimitado"]);
  });

  it("gravar na loja respeita o filtro, mesmo que a sugestão exista para outros produtos", async () => {
    const produtos = catalogo();
    await upsertProducts(db, storeId, produtos);
    await gerarSeoPendentes(db, { storeId, budgetMs: 10_000, gerador, baixar }); // gera para os 4
    const l = loja(produtos);
    const filtro = { publicados: true, comEstoque: false };
    expect(await contarParaAplicar(db, storeId, filtro)).toEqual({ vazios: 3, todos: 3 });
    const r = await aplicarSeoPendentes(db, l.api, { storeId, actor: "a@b.c", budgetMs: 10_000, modo: "vazios", filtro });
    expect(r.aplicados).toBe(3);
    expect(l.puts.map((x) => x.id).sort()).toEqual([1, 2, 3]); // o rascunho (4) ficou de fora
    expect(await contarParaAplicar(db, storeId)).toEqual({ vazios: 1, todos: 1 });
  });
});
