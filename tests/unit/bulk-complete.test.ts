import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { createRevertJob, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { describeOperation, faltaCorOuTamanho, listarFaltando, operationSchema, planOperation, type MirrorProduct } from "@/lib/bulk/operations";
import { operationFromForm } from "@/lib/bulk/form";
import { describeChanges } from "@/lib/bulk/format";
import { createJob, getJobItems, loadMirrorProducts, startJob } from "@/lib/bulk/repo";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { I18n, Product, ProductInput, Variant, VariantInput } from "@/lib/nuvemshop/types";

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
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
});

describe("faltaCorOuTamanho", () => {
  it("sem propriedades: faltam as duas", () => {
    expect(faltaCorOuTamanho([])).toEqual({ faltam: ["COR", "TAMANHO"], de: [null, null] });
  });
  it.each([["Tam"], ["TAM"], ["Tamanho"], ["TAMANHO"]])("só %s: falta a COR (o tamanho vira a 2ª propriedade)", (nome) => {
    expect(faltaCorOuTamanho([nome])).toEqual({ faltam: ["COR"], de: [null, 0] });
  });
  it.each([["Cor"], ["COR"], ["Cores"]])("só %s: falta o TAMANHO (a cor continua a 1ª)", (nome) => {
    expect(faltaCorOuTamanho([nome])).toEqual({ faltam: ["TAMANHO"], de: [0, null] });
  });
  it("já tem as duas, ou tem outra coisa: não se encaixa", () => {
    expect(faltaCorOuTamanho(["COR", "TAMANHO"])).toBeNull();
    expect(faltaCorOuTamanho(["Tamanho", "Cor"])).toBeNull();
    expect(faltaCorOuTamanho(["Material"])).toBeNull();
  });
});

describe("listarFaltando (o que aparece na tela)", () => {
  const mp = (id: number, name: string, attributes: string[]): MirrorProduct => ({ id, name, published: true, categoryIds: [], attributes, variants: [] });

  it("lista só quem está sem COR/TAMANHO e conta à parte os produtos sem nome", () => {
    const r = listarFaltando([
      mp(1, "BOLSA PALHA MARY", []),
      mp(2, "SAIA LINHO", ["TAM"]),
      mp(3, "VESTIDO COMPLETO", ["COR", "TAMANHO"]),
      mp(220941071, "Produto 220941071", []), // nome vazio na loja: o painel mostra "Produto <id>"
      mp(220941072, "Produto 220941072", []),
      mp(4, "Produto 4 de verdade", []), // nome que só começa parecido não conta como sem nome
    ]);
    expect(r.faltando.map((p) => p.id)).toEqual([1, 2, 4]);
    expect(r.faltando.map((p) => p.faltam)).toEqual([["COR", "TAMANHO"], ["COR"], ["COR", "TAMANHO"]]);
    expect(r.semNome).toBe(2);
  });
});

describe("operação 'completar': formulário e plano", () => {
  const form = (campos: Record<string, string>) => operationFromForm((n) => campos[n] ?? "");
  const mp = (id: number, attributes: string[], valores: string[][], published = true): MirrorProduct => ({
    id,
    name: `Produto ${id}`,
    published,
    categoryIds: [],
    attributes,
    variants: valores.map((values, i) => ({ id: id * 100 + i, sku: null, label: values.join(" / ") || "Padrão", price: 1, promotional_price: null, stock_management: false, stock: null, values })),
  });

  it("lê os campos por produto e ignora os em branco", () => {
    const r = form({ tipo: "completar", completar_ids: "1,2,3", cor_1: " preta ", tam_1: "", cor_2: "", tam_2: "", tam_3: "unico" });
    expect(r.op).toEqual({ type: "completar", valores: { "1": { cor: "preta" }, "3": { tamanho: "unico" } } });
    expect(describeOperation(r.op!)).toContain("2 produtos");
  });

  it("exige pelo menos um valor", () => {
    expect(form({ tipo: "completar", completar_ids: "1,2" }).error).toBe("Preencha a cor ou o tamanho de pelo menos um produto.");
  });

  it("ids e valores inválidos não passam", () => {
    expect(operationSchema.safeParse({ type: "completar", valores: { "abc": { cor: "x" } } }).success).toBe(false);
    expect(operationSchema.safeParse({ type: "completar", valores: { "1": { cor: "x".repeat(101) } } }).success).toBe(false);
  });

  it("sem propriedades: acrescenta COR e TAMANHO e padroniza a grafia do que foi digitado", () => {
    const op = operationSchema.parse({ type: "completar", valores: { "1": { cor: "azul claro", tamanho: "unico" } } });
    const plan = planOperation(op, [mp(1, [], [[]])]);
    const c = plan.items[0]!.changes;
    expect(c.product?.attributes).toEqual({ antes: [], depois: ["COR", "TAMANHO"], de: [null, null] });
    expect(c.variants[0]!.values).toEqual({ antes: [], depois: ["Azul Claro", "ÚNICO"], de: [null, null] });
    expect(describeChanges(c, () => "")[0]).toBe("Propriedades: nenhuma → COR | TAMANHO");
  });

  it("só tamanho: a cor entra na frente e o tamanho existente é mantido em todas as variantes", () => {
    const op = operationSchema.parse({ type: "completar", valores: { "1": { cor: "preta" } } });
    const plan = planOperation(op, [mp(1, ["Tam"], [["P"], ["M"]])]);
    expect(plan.items[0]!.changes.variants.map((v) => v.values?.depois)).toEqual([["Preta", "P"], ["Preta", "M"]]);
    expect(plan.items[0]!.changes.product?.attributes).toEqual({ antes: ["Tam"], depois: ["COR", "TAMANHO"], de: [null, 0] });
  });

  it("só cor: o tamanho entra depois e a cor existente é mantida em cada variante", () => {
    const op = operationSchema.parse({ type: "completar", valores: { "1": { tamanho: "único" } } });
    const plan = planOperation(op, [mp(1, ["Cor"], [["Preta"], ["Marrom"]])]);
    expect(plan.items[0]!.changes.variants.map((v) => v.values?.depois)).toEqual([["Preta", "ÚNICO"], ["Marrom", "ÚNICO"]]);
  });

  it("deixa de fora, com motivo: em branco, valor que falta, já completo e variantes repetidas", () => {
    const op = operationSchema.parse({
      type: "completar",
      valores: { "2": { tamanho: "M" }, "3": { cor: "preta" }, "5": { cor: "azul" } },
    });
    const plan = planOperation(op, [
      mp(1, ["Tam"], [["P"]]), // sem valor informado
      mp(2, ["Tam"], [["P"]]), // falta a cor
      mp(3, ["COR", "TAMANHO"], [["Preta", "P"]]), // já completo
      mp(4, [], [[]]), // sem valor informado
      mp(5, ["Tam"], [["P"], ["p"]]), // duas variantes ficariam iguais
    ]);
    expect(plan.items).toEqual([]);
    expect(plan.ignorados.map((i) => i.motivo)).toEqual([
      "sem valor informado (deixado de fora)",
      "informe a cor",
      expect.stringContaining("já tem COR e TAMANHO"),
      "sem valor informado (deixado de fora)",
      expect.stringContaining("duas variantes ficariam iguais"),
    ]);
  });
});

/* ---- "loja" falsa ---- */
class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  calls: string[] = [];
  failVariantId: number | null = null;
  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(id: number, input: ProductInput) {
    this.calls.push(`produto ${JSON.stringify(input.attributes)}`);
    if (input.attributes) this.products.get(id)!.attributes = structuredClone(input.attributes);
    return structuredClone(this.products.get(id)!);
  }
  async deleteProduct(id: number) {
    this.products.delete(id);
  }
  async updateVariant(pid: number, vid: number, input: VariantInput) {
    this.calls.push(`variante ${vid} ${JSON.stringify(input.values)}`);
    if (this.failVariantId === vid) throw new NuvemshopError("422", 422, null, "recusado");
    const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
    if (input.values) v.values = structuredClone(input.values);
    return structuredClone(v);
  }
}

const mkVariant = (id: number, pid: number, values: I18n[]): Variant => ({ id, product_id: pid, sku: null, price: "100.00", stock_management: false, stock: null, values });
const produtos = (): Product[] => [
  { id: 1, name: { pt: "Bolsa" }, published: true, categories: [], attributes: [], variants: [mkVariant(10, 1, [])], updated_at: "2026-10-01T10:00:00+0000" },
  { id: 2, name: { pt: "Saia" }, published: true, categories: [], attributes: [{ pt: "TAM", es: "Talla" }], variants: [mkVariant(20, 2, [{ pt: "G", es: "L" }])], updated_at: "2026-10-01T10:00:00+0000" },
  { id: 3, name: { pt: "Cinto" }, published: true, categories: [], attributes: [{ pt: "Cor", es: "Color" }], variants: [mkVariant(30, 3, [{ pt: "Preta", es: "Negra" }]), mkVariant(31, 3, [{ pt: "Marrom" }])], updated_at: "2026-10-01T10:00:00+0000" },
];
const op = operationSchema.parse({
  type: "completar",
  valores: { "1": { cor: "natural", tamanho: "único" }, "2": { cor: "branca" }, "3": { tamanho: "unico" } },
});

async function setup() {
  const remote = new FakeStore(produtos());
  await upsertProducts(db, storeId, produtos());
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, [1, 2, 3]));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: describeOperation(op), plan });
  return { remote, plan, jobId };
}
const run = async (remote: FakeStore, jobId: string) => {
  await startJob(db, storeId, jobId);
  return stepJob(db, remote, { storeId, actor, jobId, budgetMs: 10_000 });
};
/** Espelho de um produto, por id (a lista do banco vem ordenada por nome, não por id). */
const espelho = async (id: number) => (await loadMirrorProducts(db, storeId, [id]))[0]!;
/** Situação de cada item do lote, por id do produto. */
const statusPorProduto = async (jobId: string) => Object.fromEntries((await getJobItems(db, jobId)).map((i) => [i.product_id, i.status]));
const loja = (remote: FakeStore, id: number) => {
  const p = remote.products.get(id)!;
  return { attrs: p.attributes, valores: p.variants!.map((v) => v.values) };
};

describe("executando o lote de completar", () => {
  it("acrescenta as propriedades, mantém os outros idiomas dos valores que já existiam e regrava o espelho", async () => {
    const { remote, plan, jobId } = await setup();
    expect(plan.items).toHaveLength(3);
    expect(await run(remote, jobId)).toMatchObject({ done: true, status: "completed" });

    expect(loja(remote, 1)).toEqual({ attrs: [{ pt: "COR" }, { pt: "TAMANHO" }], valores: [[{ pt: "Natural" }, { pt: "ÚNICO" }]] });
    // o tamanho que já existia leva "Talla" e "L" junto, e passa a ser a 2ª propriedade
    expect(loja(remote, 2)).toEqual({ attrs: [{ pt: "COR" }, { pt: "TAMANHO", es: "Talla" }], valores: [[{ pt: "Branca" }, { pt: "G", es: "L" }]] });
    // a cor que já existia leva "Color" e "Negra" junto, e continua a 1ª
    expect(loja(remote, 3)).toEqual({
      attrs: [{ pt: "COR", es: "Color" }, { pt: "TAMANHO" }],
      valores: [[{ pt: "Preta", es: "Negra" }, { pt: "ÚNICO" }], [{ pt: "Marrom" }, { pt: "ÚNICO" }]],
    });
    for (const id of [1, 2, 3]) expect((await espelho(id)).attributes).toEqual(["COR", "TAMANHO"]);
    expect((await espelho(3)).variants.map((v) => v.values)).toEqual([["Preta", "ÚNICO"], ["Marrom", "ÚNICO"]]);
    expect(await statusPorProduto(jobId)).toEqual({ "1": "ok", "2": "ok", "3": "ok" });
  });

  it("se uma variante for recusada, desfaz o produto inteiro (inclusive a volta a 'sem propriedades')", async () => {
    const { remote, jobId } = await setup();
    remote.failVariantId = 31; // o 2º valor do cinto
    await run(remote, jobId);
    // a bolsa e a saia deram certo; o cinto voltou ao que era
    expect(loja(remote, 3)).toEqual({ attrs: produtos()[2]!.attributes, valores: produtos()[2]!.variants!.map((v) => v.values) });
    expect(await statusPorProduto(jobId)).toEqual({ "1": "ok", "2": "ok", "3": "error" });
    const cinto = (await getJobItems(db, jobId)).find((i) => i.product_id === "3");
    expect(cinto?.resultado?.mensagem).toContain("o produto ficou como estava");
  });

  it("dá para reverter: volta às propriedades e valores originais, até a 'sem propriedades'", async () => {
    const { remote, jobId } = await setup();
    await run(remote, jobId);
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await run(remote, revertId);
    for (const p of produtos()) {
      expect(loja(remote, p.id)).toEqual({ attrs: p.attributes, valores: p.variants!.map((v) => v.values) });
    }
    expect((await espelho(1)).attributes).toEqual([]);
    expect((await espelho(2)).attributes).toEqual(["TAM"]);
    expect((await espelho(3)).attributes).toEqual(["Cor"]);
  });
});

describe("contra os 10 produtos reais que faltam COR ou TAMANHO (auditoria de 04/10/2026)", () => {
  // [id, propriedades, valores de cada variante]
  const reais: Array<[number, string[], string[][]]> = [
    [312181282, [], [[]]], // BOLSA PALHA MARY
    [344545527, [], [[]]], // Cinto Couro
    [341242848, [], [[]]], // VESTIDO VITÓRIA
    [286439832, ["Cor"], [["Preta"], ["Marrom"]]], // CINTO COURO ZAMAK
    [311639899, ["TAM"], [["G"]]], // SAIA LINHO
    [272330411, ["Tamanho"], [["Único"]]], // VESTIDO ALICIA TRICÔ
    [309607308, ["Tamanho"], [["UNICO"]]], // VESTIDO ESTELLA
    [309619165, ["Tamanho"], [["UNICO"]]], // VESTIDO MANU
    [309623201, ["TAM"], [["M"]]], // VESTIDO PAOLA
    [309622558, ["Tamanho"], [["M"]]], // VESTIDO SUELLEN
  ];
  const mirror: MirrorProduct[] = reais.map(([id, attributes, valores]) => ({
    id,
    name: `Produto ${id}`,
    published: false,
    categoryIds: [],
    attributes,
    variants: valores.map((values, i) => ({ id: id * 10 + i, sku: null, label: values.join(" / "), price: 1, promotional_price: null, stock_management: false, stock: null, values })),
  }));

  it("todos os 10 se encaixam: 3 sem propriedades, 6 só com tamanho, 1 só com cor", () => {
    const tipos = reais.map(([, attrs]) => faltaCorOuTamanho(attrs)?.faltam.join("+"));
    expect(tipos).toEqual(["COR+TAMANHO", "COR+TAMANHO", "COR+TAMANHO", "TAMANHO", "COR", "COR", "COR", "COR", "COR", "COR"]);
  });

  it("com todos os valores informados, completa os 10 produtos (11 variantes)", () => {
    const valores: Record<string, { cor?: string; tamanho?: string }> = {};
    for (const [id, attrs] of reais) valores[String(id)] = attrs.length === 0 ? { cor: "Natural", tamanho: "ÚNICO" } : attrs[0] === "Cor" ? { tamanho: "ÚNICO" } : { cor: "Preta" };
    const plan = planOperation(operationSchema.parse({ type: "completar", valores }), mirror);
    expect(plan.ignorados).toEqual([]);
    expect(plan.items).toHaveLength(10);
    expect(plan.items.reduce((n, i) => n + i.changes.variants.length, 0)).toBe(11);
  });

  it("os produtos em branco ficam de fora e o resto segue", () => {
    const plan = planOperation(operationSchema.parse({ type: "completar", valores: { "311639899": { cor: "Linho" } } }), mirror);
    expect(plan.items.map((i) => i.productId)).toEqual([311639899]);
    expect(plan.ignorados).toHaveLength(9);
  });
});
