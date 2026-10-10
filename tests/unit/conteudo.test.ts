import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { createRevertJob, runItem, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { operationFromForm } from "@/lib/bulk/form";
import { describeChanges } from "@/lib/bulk/format";
import { describeOperation, operationSchema, planOperation } from "@/lib/bulk/operations";
import { createJob, getJobItems, loadMirrorProducts, startJob } from "@/lib/bulk/repo";
import { aplicarBloco, marcaAbre, removerBloco, temBloco } from "@/lib/content/aplicar";
import { BlocoError, excluirBloco, listarBlocos, obterBloco, salvarBloco, usoDosBlocos, validarBloco } from "@/lib/content/blocks";
import { gerarPagina, pendenciasNoTexto } from "@/lib/content/pagina-ia";
import { acaoLabel } from "@/lib/history/labels";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { pt, type Product, type ProductInput, type Variant, type VariantInput } from "@/lib/nuvemshop/types";

const ID = "11111111-2222-4333-8444-555555555555";
const HTML = "<h3>Medidas</h3><p>PP 80</p>";
const bloco = { id: ID, html: HTML };

describe("aplicar e remover bloco (puro)", () => {
  it("acrescenta no fim com a marca, ou no começo", () => {
    const fim = aplicarBloco("<p>Vestido</p>", bloco) as { depois: string };
    expect(fim.depois).toBe(`<p>Vestido</p>\n${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->`);
    const ini = aplicarBloco("<p>Vestido</p>", bloco, "inicio") as { depois: string };
    expect(ini.depois.startsWith(marcaAbre(ID))).toBe(true);
    expect(ini.depois.endsWith("<p>Vestido</p>")).toBe(true);
  });

  it("descrição vazia ou nula recebe só o bloco", () => {
    expect((aplicarBloco(null, bloco) as { depois: string }).depois).toBe(`${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->`);
  });

  it("não duplica: igual -> pula; versão antiga -> atualiza no mesmo lugar", () => {
    const um = (aplicarBloco("<p>A</p>", bloco) as { depois: string }).depois;
    expect(aplicarBloco(um, bloco)).toEqual({ motivo: "já tem este bloco, igual ao atual" });
    const novo = { id: ID, html: "<h3>Medidas</h3><p>PP 82</p>" };
    const depois = (aplicarBloco(`${um}\n<p>Fim</p>`, novo) as { depois: string }).depois;
    expect(depois).toContain("PP 82");
    expect(depois).not.toContain("PP 80");
    expect(depois.match(/inuvem:bloco/g)).toHaveLength(2); // abre + fecha, uma vez só
    expect(depois.endsWith("<p>Fim</p>")).toBe(true);
  });

  it("acha o bloco mesmo se um editor tirou as marcas (mesmo HTML)", () => {
    const semMarca = `<p>A</p>${HTML}`;
    expect(temBloco(semMarca, bloco)).toBe(true);
    expect(aplicarBloco(semMarca, bloco)).toMatchObject({ motivo: expect.stringMatching(/sem a marca/) });
    expect((removerBloco(semMarca, bloco) as { depois: string }).depois).toBe("<p>A</p>");
  });

  it("remove só o bloco e preserva o resto; recusa deixar a descrição vazia", () => {
    const com = `<p>A</p>\n${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->\n<p>B</p>`;
    expect((removerBloco(com, bloco) as { depois: string }).depois).toBe("<p>A</p>\n<p>B</p>");
    expect(removerBloco("<p>A</p>", bloco)).toEqual({ motivo: "não tem este bloco" });
    expect(removerBloco(`${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->`, bloco)).toEqual({ motivo: "a descrição ficaria vazia" });
  });
});

describe("validação do bloco", () => {
  it("limpa scripts e eventos, e exige nome e conteúdo", () => {
    const v = validarBloco("  Tabela   de medidas ", '<p onclick="x()">Oi</p><script>alert(1)</script>');
    expect(v).toEqual({ ok: true, name: "Tabela de medidas", html: "<p>Oi</p>" });
    expect(validarBloco("", "<p>x</p>")).toMatchObject({ ok: false });
    expect(validarBloco("Nome", "<p> </p>")).toMatchObject({ ok: false });
    expect(validarBloco("N".repeat(81), "<p>x</p>")).toMatchObject({ ok: false });
  });
});

let pg: PGlite;
let db: Db;
let storeId: string;
const actor = "admin@example.com";

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations({ exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never }, loadMigrations(join(process.cwd(), "db/migrations")));
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

describe("blocos no banco", () => {
  it("cria, atualiza, lista, bloqueia nome repetido e exclui", async () => {
    const id = await salvarBloco(db, { storeId, actor, name: "Medidas", html: "<p>PP</p>" });
    await expect(salvarBloco(db, { storeId, actor, name: "medidas", html: "<p>x</p>" })).rejects.toThrow(BlocoError);
    await salvarBloco(db, { storeId, actor, id, name: "Medidas", html: "<p>PP e P</p>" });
    expect((await obterBloco(db, storeId, id))?.html).toBe("<p>PP e P</p>");
    expect((await listarBlocos(db, storeId)).map((b) => b.name)).toEqual(["Medidas"]);
    expect(await obterBloco(db, storeId, "não-é-uuid")).toBeNull();
    expect(await excluirBloco(db, storeId, id)).toBe(true);
    expect(await listarBlocos(db, storeId)).toEqual([]);
  });

  it("conta os produtos do espelho que têm o bloco", async () => {
    const id = await salvarBloco(db, { storeId, actor, name: "Medidas", html: "<p>PP</p>" });
    await upsertProducts(db, storeId, [
      prod(1, `<p>A</p>${marcaAbre(id)}<p>PP</p><!--/inuvem:bloco:${id}-->`),
      prod(2, "<p>B</p>"),
    ]);
    expect((await usoDosBlocos(db, storeId, [id])).get(id)).toBe(1);
  });
});

/* ---- loja falsa com descrição ---- */
class Loja implements BulkApi {
  products = new Map<number, Product>();
  /** simula uma loja que limpa comentários HTML ao gravar */
  tiraComentarios = false;
  puts: ProductInput[] = [];
  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(id: number, input: ProductInput) {
    this.puts.push(structuredClone(input));
    const p = this.products.get(id)!;
    if (input.description) {
      if (Object.values(input.description).every((x) => x === "")) throw new NuvemshopError("422", 422, null, "vazio");
      p.description = { ...input.description, pt: this.tiraComentarios ? (input.description.pt ?? "").replace(/<!--[\s\S]*?-->/g, "") : (input.description.pt ?? "") };
    }
    return structuredClone(p);
  }
  async deleteProduct() {}
  async updateVariant(_p: number, _v: number, _i: VariantInput): Promise<Variant> {
    throw new Error("não usado");
  }
}
const prod = (id: number, description: string): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  description: { pt: description },
  published: true,
  categories: [{ id: 1, name: { pt: "Cat 1" } }],
  variants: [{ id: id * 10, product_id: id, sku: `S${id}`, price: "100.00", stock_management: true, stock: 5, values: [{ pt: "U" }] }],
  updated_at: "2026-10-01T10:00:00+0000",
});

async function novoLote(blocoId: string, html: string, mode: "aplicar" | "remover", ids: number[]) {
  const op = operationSchema.parse({ type: "conteudo", mode, blockId: blocoId, nome: "Medidas", html, posicao: "fim" });
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, ids));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: describeOperation(op), plan });
  return { jobId, plan, op };
}

describe("lote de conteúdo", () => {
  it("planeja: acrescenta, atualiza e pula quem já tem; mostra o resumo", async () => {
    const igual = `${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->`;
    const velho = `${marcaAbre(ID)}<p>velho</p><!--/inuvem:bloco:${ID}-->`;
    await upsertProducts(db, storeId, [prod(1, "<p>A</p>"), prod(2, igual), prod(3, velho)]);
    const { plan, op } = await novoLote(ID, HTML, "aplicar", [1, 2, 3]);
    expect(plan.items.map((i) => i.productId)).toEqual([1, 3]);
    expect(plan.ignorados).toEqual([expect.objectContaining({ productId: 2, motivo: expect.stringMatching(/igual/) })]);
    expect(describeChanges(plan.items[0]!.changes, String)[0]).toMatch(/Acrescenta o bloco “Medidas” no fim/);
    expect(describeChanges(plan.items[1]!.changes, String)[0]).toMatch(/Atualiza o bloco/);
    expect(describeOperation(op)).toMatch(/Aplicar o bloco “Medidas”/);
  });

  it("aplica na loja só a descrição (o resto do PUT fica de fora), atualiza o espelho, audita e reverte", async () => {
    await upsertProducts(db, storeId, [prod(1, "<p>A</p>")]);
    const api = new Loja([prod(1, "<p>A</p>")]);
    const { jobId } = await novoLote(ID, HTML, "aplicar", [1]);
    await startJob(db, storeId, jobId);
    await stepJob(db, api, { storeId, actor, jobId, budgetMs: 10_000 });
    expect(Object.keys(api.puts[0]!)).toEqual(["description"]);
    expect(pt(api.products.get(1)!.description)).toContain(marcaAbre(ID));
    expect((await pg.query<{ description: string }>("SELECT description FROM products WHERE id = 1")).rows[0]!.description).toContain("Medidas");
    const aud = (await pg.query("SELECT acao, sucesso, antes, depois FROM audit_log WHERE acao = 'lote.conteudo'")).rows as Array<{ sucesso: boolean; antes: Record<string, string>; depois: Record<string, string> }>;
    expect(aud).toHaveLength(1);
    expect(aud[0]!.antes.descricao).toBe("<p>A</p>");
    expect(aud[0]!.depois.descricao).toContain(HTML);
    expect(acaoLabel("lote.conteudo")).toMatch(/bloco de conteúdo/);

    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await startJob(db, storeId, revertId);
    await stepJob(db, api, { storeId, actor, jobId: revertId, budgetMs: 10_000 });
    expect(pt(api.products.get(1)!.description)).toBe("<p>A</p>");
  });

  it("conflito: se a descrição mudou na loja desde a pré-visualização, não altera", async () => {
    await upsertProducts(db, storeId, [prod(1, "<p>A</p>")]);
    const api = new Loja([prod(1, "<p>A editada na loja</p>")]);
    const { jobId } = await novoLote(ID, HTML, "aplicar", [1]);
    await startJob(db, storeId, jobId);
    await stepJob(db, api, { storeId, actor, jobId, budgetMs: 10_000 });
    const item = (await getJobItems(db, jobId))[0]!;
    expect(item.status).toBe("conflict");
    expect(api.puts).toEqual([]);
  });

  it("se a loja tira a marca ao gravar, desfaz e avisa (nada fica perdido)", async () => {
    await upsertProducts(db, storeId, [prod(1, "<p>A</p>")]);
    const api = new Loja([prod(1, "<p>A</p>")]);
    api.tiraComentarios = true;
    const { jobId } = await novoLote(ID, HTML, "aplicar", [1]);
    await startJob(db, storeId, jobId);
    await stepJob(db, api, { storeId, actor, jobId, budgetMs: 10_000 });
    const item = (await getJobItems(db, jobId))[0]!;
    expect(item.status).toBe("error");
    expect(item.resultado?.mensagem).toMatch(/não manteve a marca/);
    expect(api.puts).toHaveLength(2); // gravou e voltou ao que era
    expect(pt(api.products.get(1)!.description)).toBe("<p>A</p>");
  });

  it("remover tira só o bloco", async () => {
    const com = `<p>A</p>\n${marcaAbre(ID)}${HTML}<!--/inuvem:bloco:${ID}-->`;
    await upsertProducts(db, storeId, [prod(1, com)]);
    const api = new Loja([prod(1, com)]);
    const { jobId } = await novoLote(ID, HTML, "remover", [1]);
    await startJob(db, storeId, jobId);
    await stepJob(db, api, { storeId, actor, jobId, budgetMs: 10_000 });
    expect(pt(api.products.get(1)!.description)).toBe("<p>A</p>");
  });
});

describe("formulário do lote", () => {
  const get = (m: Record<string, string>) => (n: string) => m[n] ?? "";
  it("lê a operação de conteúdo e exige a escolha do bloco", () => {
    expect(operationFromForm(get({ tipo: "conteudo", conteudo_modo: "aplicar", conteudo_bloco: ID, conteudo_posicao: "inicio" })).op).toMatchObject({ type: "conteudo", mode: "aplicar", blockId: ID, posicao: "inicio" });
    expect(operationFromForm(get({ tipo: "conteudo", conteudo_modo: "aplicar" })).error).toMatch(/Escolha o bloco/);
    expect(operationFromForm(get({ tipo: "conteudo", conteudo_modo: "xis", conteudo_bloco: ID })).error).toMatch(/aplicar ou remover/);
    expect(operationFromForm(get({ tipo: "conteudo", conteudo_modo: "aplicar", conteudo_bloco: "não-uuid" })).error).toMatch(/inválidos/);
  });
});

/* ---- páginas escritas pela IA ---- */
const claudeFalso = (json: unknown) =>
  ({ beta: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 10, output_tokens: 20 } }) } } }) as never;

describe("páginas com a IA", () => {
  it("limpa o HTML e junta o que faltou com os [preencher: …] do texto", async () => {
    const r = await gerarPagina({
      tipo: "trocas",
      fatos: "Troca em 7 dias.",
      client: claudeFalso({ titulo: "Trocas e devoluções", html: '<h2>Prazo</h2><p onclick="x()">7 dias.</p><p>[preencher: quem paga o frete]</p><script>x()</script>', faltando: ["canal de contato"] }),
    });
    expect(r.html).not.toMatch(/script|onclick/);
    expect(r.faltando).toEqual(["canal de contato", "quem paga o frete"]);
    expect(pendenciasNoTexto(r.html)).toBe(1);
  });
});
