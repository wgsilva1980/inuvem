import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { createRevertJob, precisaDeTudoOuNada, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { describeOperation, operationSchema, planOperation, type MirrorProduct } from "@/lib/bulk/operations";
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

describe("operação 'ordem': plano", () => {
  const op = operationSchema.parse({ type: "ordem" });
  const mp = (id: number, attributes: string[], valores: string[][]): MirrorProduct => ({
    id,
    name: `Produto ${id}`,
    published: true,
    categoryIds: [],
    attributes,
    variants: valores.map((values, i) => ({ id: id * 100 + i, sku: null, label: values.join(" / "), price: 1, promotional_price: null, stock_management: false, stock: null, values })),
  });

  it("entra no schema, no formulário e na descrição", () => {
    expect(op).toEqual({ type: "ordem" });
    expect(operationFromForm((n) => (n === "tipo" ? "ordem" : "")).op).toEqual({ type: "ordem" });
    expect(describeOperation(op)).toContain("Corrigir a ordem");
  });

  it.each([["Tamanho", "Cor"], ["TAMANHO", "Cor"], ["TAM", "Cor"], ["TAMANHO", "COR,"], ["Tamanho", "COR"]])("%s | %s: troca a ordem e os valores", (a, b) => {
    const plan = planOperation(op, [mp(1, [a, b], [["P", "Preta"], ["M", "Preta"]])]);
    expect(plan.items).toHaveLength(1);
    const c = plan.items[0]!.changes;
    expect(c.product?.attributes).toEqual({ antes: [a, b], depois: ["COR", "TAMANHO"], trocar: true });
    expect(c.variants.map((v) => v.values)).toEqual([
      { antes: ["P", "Preta"], depois: ["Preta", "P"], trocar: true },
      { antes: ["M", "Preta"], depois: ["Preta", "M"], trocar: true },
    ]);
    expect(describeChanges(c, () => "")[0]).toBe(`Propriedades: ${a} | ${b} → COR | TAMANHO (ordem trocada)`);
    expect(precisaDeTudoOuNada(c)).toBe(true);
  });

  it("deixa de fora, com motivo, o que não é ordem invertida de duas propriedades", () => {
    const plan = planOperation(op, [
      mp(1, ["COR", "TAMANHO"], [["Preta", "P"]]),
      mp(2, ["Cor", "Tam"], [["Preta", "P"]]),
      mp(3, ["Tamanho"], [["P"]]),
      mp(4, [], [[]]),
      mp(5, ["Tamanho", "Material"], [["P", "Algodão"]]),
      mp(6, ["Tamanho", "Cor"], [["P"]]),
    ]);
    expect(plan.items).toEqual([]);
    expect(plan.ignorados.map((i) => i.motivo)).toEqual([
      "já está na ordem COR, TAMANHO",
      "já está na ordem COR, TAMANHO",
      "tem 1 propriedade (Tamanho); só corrijo produtos com duas",
      "não tem propriedades",
      "nomes não reconhecidos (Tamanho | Material)",
      "a quantidade de valores das variantes não bate com a de propriedades",
    ]);
  });
});

/* ---- "loja" falsa ---- */
class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  calls: string[] = [];
  failVariantId: number | null = null;
  /** Depois da primeira recusa, todo envio seguinte também é recusado (simula a loja fora do ar). */
  breakAfterFailure = false;
  private broken = false;
  /** A loja aceita o envio de propriedades mas não muda nada (simula um comportamento inesperado da API). */
  ignoreAttributes = false;

  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  private refuse(): never {
    if (this.breakAfterFailure) this.broken = true;
    throw new NuvemshopError("422", 422, null, "recusado");
  }
  async updateProduct(id: number, input: ProductInput) {
    this.calls.push(`produto ${JSON.stringify(input.attributes?.map((a) => a.pt))}`);
    if (this.broken) this.refuse();
    const p = this.products.get(id)!;
    if (input.attributes && !this.ignoreAttributes) p.attributes = structuredClone(input.attributes);
    return structuredClone(p);
  }
  async updateVariant(pid: number, vid: number, input: VariantInput) {
    this.calls.push(`variante ${vid} ${JSON.stringify(input.values?.map((v) => v.pt))}`);
    if (this.broken || this.failVariantId === vid) this.refuse();
    const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
    if (input.values) v.values = structuredClone(input.values);
    return structuredClone(v);
  }
}

const mkVariant = (id: number, pid: number, values: I18n[]): Variant => ({ id, product_id: pid, sku: `S${id}`, price: "100.00", stock_management: false, stock: null, values });
const original = (): Product => ({
  id: 1,
  name: { pt: "Blusa" },
  published: true,
  categories: [],
  attributes: [{ pt: "TAMANHO", es: "Talla" }, { pt: "Cor", es: "Color" }],
  variants: [
    mkVariant(10, 1, [{ pt: "P", es: "S" }, { pt: "Preta", es: "Negra" }]),
    mkVariant(11, 1, [{ pt: "M" }, { pt: "Preta" }]),
    mkVariant(12, 1, [{ pt: "G" }, { pt: "Branca" }]),
  ],
  updated_at: "2026-10-01T10:00:00+0000",
});

const mirror = async () => (await loadMirrorProducts(db, storeId, [1]))[0]!;
const audits = async () => (await pg.query("SELECT acao, sucesso FROM audit_log WHERE acao LIKE 'lote.%' AND acao <> 'lote.criar' ORDER BY id")).rows as Array<Record<string, unknown>>;

async function setup() {
  const remote = new FakeStore([original()]);
  await upsertProducts(db, storeId, [original()]);
  const op = operationSchema.parse({ type: "ordem" });
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, [1]));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: describeOperation(op), plan });
  return { remote, jobId };
}
const run = async (remote: FakeStore, jobId: string) => {
  await startJob(db, storeId, jobId);
  return stepJob(db, remote, { storeId, actor, jobId, budgetMs: 10_000 });
};
const estadoDaLoja = (remote: FakeStore) => {
  const p = remote.products.get(1)!;
  return { attrs: p.attributes?.map((a) => a.pt), valores: p.variants?.map((v) => (v.values ?? []).map((x) => x.pt)) };
};

describe("operação 'ordem': execução", () => {
  it("troca a ordem e os valores, levando os outros idiomas junto, e regrava o espelho", async () => {
    const { remote, jobId } = await setup();
    expect(await run(remote, jobId)).toMatchObject({ done: true, status: "completed" });
    expect(estadoDaLoja(remote)).toEqual({ attrs: ["COR", "TAMANHO"], valores: [["Preta", "P"], ["Preta", "M"], ["Branca", "G"]] });
    // os objetos multi-idioma andaram junto: "Color" ficou com COR e "Talla" com TAMANHO; "Negra" com Preta e "S" com P
    const p = remote.products.get(1)!;
    expect(p.attributes).toEqual([{ pt: "COR", es: "Color" }, { pt: "TAMANHO", es: "Talla" }]);
    expect(p.variants![0]!.values).toEqual([{ pt: "Preta", es: "Negra" }, { pt: "P", es: "S" }]);
    const m = await mirror();
    expect(m.attributes).toEqual(["COR", "TAMANHO"]);
    expect(m.variants.map((v) => v.values)).toEqual([["Preta", "P"], ["Preta", "M"], ["Branca", "G"]]);
    expect(await audits()).toMatchObject([{ acao: "lote.ordem", sucesso: true }]);
    expect((await getJobItems(db, jobId))[0]?.status).toBe("ok");
  });

  it("se uma variante for recusada no meio, desfaz tudo e o produto fica como estava", async () => {
    const { remote, jobId } = await setup();
    remote.failVariantId = 11;
    await run(remote, jobId);
    expect(estadoDaLoja(remote)).toEqual(estadoDaLoja(new FakeStore([original()])));
    expect(remote.products.get(1)!.attributes).toEqual(original().attributes); // inclusive os outros idiomas
    expect(remote.products.get(1)!.variants![0]!.values).toEqual(original().variants![0]!.values);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("error");
    expect(item?.resultado?.mensagem).toContain("o produto ficou como estava");
    expect(item?.resultado?.mensagem).not.toContain("..");
    expect(item?.resultado?.partes?.every((p) => !p.ok)).toBe(true);
    expect((await mirror()).attributes).toEqual(["TAMANHO", "Cor"]);
    expect(await audits()).toMatchObject([{ acao: "lote.ordem", sucesso: false }]);
  });

  it("se a primeira etapa já falha, nada foi aplicado e nada precisa ser desfeito", async () => {
    const { remote, jobId } = await setup();
    remote.breakAfterFailure = true;
    // faz a 1ª chamada (propriedades) falhar
    const original1 = remote.updateProduct.bind(remote);
    remote.updateProduct = async (id, input) => {
      remote.calls.push("falha");
      throw new NuvemshopError("422", 422, null, "recusado");
      void original1;
    };
    await run(remote, jobId);
    expect(remote.calls).toEqual(["falha"]);
    const [item] = await getJobItems(db, jobId);
    expect(item?.resultado?.mensagem).toContain("Nada foi alterado neste produto");
  });

  it("se a loja cair no meio e não deixar desfazer, avisa com ATENÇÃO o que ficou", async () => {
    const { remote, jobId } = await setup();
    remote.failVariantId = 11;
    remote.breakAfterFailure = true;
    await run(remote, jobId);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("error");
    expect(item?.resultado?.mensagem).toContain("ATENÇÃO");
    expect(item?.resultado?.mensagem).toContain("Confira este produto na loja");
  });

  it("se a loja aceitar mas não ficar como esperado, desfaz (confere depois de aplicar)", async () => {
    const { remote, jobId } = await setup();
    remote.ignoreAttributes = true; // as propriedades não mudam, mas os valores das variantes sim
    await run(remote, jobId);
    expect(estadoDaLoja(remote)).toEqual({ attrs: ["TAMANHO", "Cor"], valores: [["P", "Preta"], ["M", "Preta"], ["G", "Branca"]] });
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("error");
    expect(item?.resultado?.mensagem).toMatch(/^A loja ficou com as propriedades/); // primeira letra maiúscula
    expect(item?.resultado?.mensagem).toContain("em vez de");
    expect(item?.resultado?.mensagem).toContain("o produto ficou como estava");
  });

  it("se a loja mudou desde a pré-visualização, marca conflito e não altera", async () => {
    const { remote, jobId } = await setup();
    remote.products.get(1)!.variants![0]!.values = [{ pt: "PP" }, { pt: "Preta" }];
    await run(remote, jobId);
    expect(remote.calls).toEqual([]);
    expect((await getJobItems(db, jobId))[0]?.status).toBe("conflict");
  });

  it("dá para reverter: volta à ordem e aos valores originais, com os outros idiomas", async () => {
    const { remote, jobId } = await setup();
    await run(remote, jobId);
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await run(remote, revertId);
    expect(remote.products.get(1)!.attributes).toEqual(original().attributes);
    expect(remote.products.get(1)!.variants!.map((v) => v.values)).toEqual(original().variants!.map((v) => v.values));
    expect((await mirror()).attributes).toEqual(["TAMANHO", "Cor"]);
  });
});

describe("contra os 14 produtos reais com a ordem invertida (auditoria de 04/10/2026)", () => {
  const grade = (tamanhos: string[], cores: string[]) => tamanhos.flatMap((t) => cores.map((c) => [t, c]));
  // [propriedades, valores [tamanho, cor] de cada variante]
  const reais: Array<[string[], string[][]]> = [
    [["Tamanho", "Cor"], [["P", "AMARELO MANTEIGA"]]],
    [["TAMANHO", "Cor"], grade(["P", "M", "G"], ["OFF WHITE", "Azul claro", "AMARELO MANTEIGA"])],
    [["TAMANHO", "COR"], grade(["P", "M", "G"], ["NUDE"])],
    [["TAMANHO", "COR,"], [["ÚNICO", "PEROLA"]]],
    [["TAMANHO", "COR"], [["P", "CARAMELO"]]],
    [["Tamanho", "Cor"], [["P", "VERDE MENTA"]]],
    [["TAMANHO", "Cor"], grade(["P", "M", "PP"], ["VERDE MENTA", "AREIA"])],
    [["TAM", "Cor"], [["M", "AZUL SERENITY"]]],
    [["Tamanho", "Cor"], grade(["M", "P", "G"], ["OFF WHITE"])],
    [["Tamanho", "Cor"], [["Único", "Marrom"], ["Único", "Preto"]]],
    [["Tamanho", "Cor"], grade(["P", "M", "G"], ["Branco", "Amarelo", "Preto"])],
    [["TAMANHO", "COR"], grade(["P", "M"], ["OFF WHITE", "AZUL SERENITY"])],
    [["Tamanho", "Cor"], [["M", "Preta"]]],
    [["Tamanho", "Cor"], [["P", "Branca"]]],
  ];
  const op = operationSchema.parse({ type: "ordem" });
  const produtos: MirrorProduct[] = reais.map(([attributes, valores], i) => ({
    id: i + 1,
    name: `Produto real ${i + 1}`,
    published: false,
    categoryIds: [],
    attributes,
    variants: valores.map((values, j) => ({ id: (i + 1) * 100 + j, sku: null, label: values.join(" / "), price: 1, promotional_price: null, stock_management: false, stock: null, values })),
  }));

  it("corrige os 14 produtos e as 43 variantes, sem deixar nenhum de fora", () => {
    const plan = planOperation(op, produtos);
    expect(plan.ignorados).toEqual([]);
    expect(plan.items).toHaveLength(14);
    expect(plan.items.reduce((n, i) => n + i.changes.variants.length, 0)).toBe(43);
  });

  it("em toda variante, a cor vai para a 1ª posição e o tamanho para a 2ª", () => {
    const plan = planOperation(op, produtos);
    plan.items.forEach((item, i) => {
      item.changes.variants.forEach((v, j) => {
        const [tamanho, cor] = reais[i]![1][j]!;
        expect(v.values?.depois).toEqual([cor, tamanho]);
      });
    });
  });
});
