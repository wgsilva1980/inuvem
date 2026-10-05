import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { createRevertJob, findMismatches, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { describeOperation, operationSchema, planAtributos, planOperation } from "@/lib/bulk/operations";
import { operationFromForm } from "@/lib/bulk/form";
import { describeChanges } from "@/lib/bulk/format";
import { createJob, getJob, getJobItems, loadMirrorProducts, startJob } from "@/lib/bulk/repo";
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

describe("planAtributos", () => {
  it.each([
    [["Cor", "Tam"]],
    [["COR", "TAM"]],
    [["Cor", "Tamanho"]],
    [["cor", "TAMANHO"]],
    [["COR", "TAMAMHO"]],
    [["CORES", "TAMANHO"]],
    [["Cór ", "Tamanho,"]],
  ])("%j vira COR e TAMANHO", (atuais) => {
    expect(planAtributos(atuais)).toEqual({ depois: ["COR", "TAMANHO"] });
  });

  it("já no padrão: fica de fora", () => {
    expect(planAtributos(["COR", "TAMANHO"])).toEqual({ motivo: "já está com COR e TAMANHO" });
  });

  it("ordem invertida: fica de fora, explicando por que renomear não basta", () => {
    expect(planAtributos(["Tamanho", "Cor"])).toMatchObject({ motivo: expect.stringContaining("ordem invertida") });
    expect(planAtributos(["TAMANHO", "COR,"])).toMatchObject({ motivo: expect.stringContaining("ordem invertida") });
  });

  it("uma, nenhuma, três propriedades ou nomes desconhecidos: ficam de fora", () => {
    expect(planAtributos([])).toMatchObject({ motivo: expect.stringContaining("não tem propriedades") });
    expect(planAtributos(["Tam"])).toMatchObject({ motivo: expect.stringContaining("só tem uma propriedade") });
    expect(planAtributos(["Cor", "Tam", "Material"])).toMatchObject({ motivo: expect.stringContaining("3 propriedades") });
    expect(planAtributos(["Material", "Estampa"])).toMatchObject({ motivo: expect.stringContaining("não reconhecidos") });
  });
});

describe("operação 'propriedades'", () => {
  const op = operationSchema.parse({ type: "propriedades" });
  const mp = (id: number, attributes: string[]) => ({ id, name: `Produto ${id}`, published: true, categoryIds: [], attributes, variants: [] });

  it("entra no schema, no formulário e na descrição", () => {
    expect(op).toEqual({ type: "propriedades" });
    expect(operationFromForm((n) => (n === "tipo" ? "propriedades" : "")).op).toEqual({ type: "propriedades" });
    expect(describeOperation(op)).toBe("Padronizar as propriedades das variações para COR e TAMANHO");
  });

  it("planeja só o que renomeia e explica o resto", () => {
    const plan = planOperation(op, [mp(1, ["Cor", "Tam"]), mp(2, ["COR", "TAMANHO"]), mp(3, ["Tamanho", "Cor"]), mp(4, ["Tam"])]);
    expect(plan.items.map((i) => [i.productId, i.changes.product?.attributes])).toEqual([[1, { antes: ["Cor", "Tam"], depois: ["COR", "TAMANHO"] }]]);
    expect(plan.ignorados.map((i) => i.productId)).toEqual([2, 3, 4]);
    expect(describeChanges(plan.items[0]!.changes, () => "")).toEqual(["Propriedades: Cor | Tam → COR | TAMANHO"]);
  });
});

/* ---- "loja" falsa ---- */
class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  puts: Array<{ id: number; input: ProductInput }> = [];
  failProduct = false;
  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(id: number, input: ProductInput) {
    this.puts.push({ id, input });
    if (this.failProduct) throw new NuvemshopError("422", 422, null, "recusado");
    const p = this.products.get(id)!;
    if (input.attributes) p.attributes = input.attributes;
    return structuredClone(p);
  }
  async updateVariant(_p: number, _v: number, _input: VariantInput): Promise<Variant> {
    throw new Error("não deveria mexer em variantes");
  }
}

const prod = (id: number, attributes: I18n[]): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  published: true,
  categories: [],
  attributes,
  variants: [{ id: id * 10, product_id: id, sku: `S${id}`, price: "100.00", stock_management: true, stock: 5, values: attributes.map((_, i) => ({ pt: `V${i}` })) }],
  updated_at: "2026-10-01T10:00:00+0000",
});

const attrsOf = async (id: number) => (await loadMirrorProducts(db, storeId, [id]))[0]!.attributes;
const audits = async () => (await pg.query("SELECT acao, entidade, entidade_id, sucesso, antes, depois FROM audit_log WHERE acao LIKE 'lote.%' AND acao <> 'lote.criar' ORDER BY id")).rows as Array<Record<string, unknown>>;

async function setup(list: Product[]) {
  const remote = new FakeStore(list);
  await upsertProducts(db, storeId, list);
  const op = operationSchema.parse({ type: "propriedades" });
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, list.map((p) => p.id)));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: describeOperation(op), plan });
  return { remote, plan, jobId };
}
const run = async (remote: FakeStore, jobId: string) => {
  await startJob(db, storeId, jobId);
  return stepJob(db, remote, { storeId, actor, jobId, budgetMs: 10_000 });
};

describe("executando o lote de propriedades", () => {
  it("renomeia na loja preservando outros idiomas, regrava o espelho e registra", async () => {
    const { remote, plan, jobId } = await setup([prod(1, [{ pt: "Cor", es: "Color" }, { pt: "Tam" }]), prod(2, [{ pt: "COR" }, { pt: "TAMANHO" }])]);
    expect(plan.items).toHaveLength(1);
    const r = await run(remote, jobId);
    expect(r).toMatchObject({ done: true, status: "completed" });
    expect(remote.puts).toEqual([{ id: 1, input: { attributes: [{ pt: "COR", es: "Color" }, { pt: "TAMANHO" }] } }]);
    expect(await attrsOf(1)).toEqual(["COR", "TAMANHO"]);
    expect(await attrsOf(2)).toEqual(["COR", "TAMANHO"]);
    expect(await audits()).toMatchObject([{ acao: "lote.propriedades", entidade_id: "1", sucesso: true, depois: { propriedades: ["COR", "TAMANHO"] } }]);
    expect((await getJobItems(db, jobId))[0]?.status).toBe("ok");
  });

  it("se a loja mudou as propriedades depois da pré-visualização, não altera e marca conflito", async () => {
    const { remote, jobId } = await setup([prod(1, [{ pt: "Cor" }, { pt: "Tam" }])]);
    remote.products.get(1)!.attributes = [{ pt: "Cor" }, { pt: "Numeração" }];
    await run(remote, jobId);
    expect(remote.puts).toEqual([]);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("conflict");
    expect(item?.resultado?.mensagem).toContain("propriedades das variações");
    expect(await attrsOf(1)).toEqual(["Cor", "Numeração"]); // o espelho passou a refletir a loja
  });

  it("recusa da loja: o item fica com erro e nada muda no espelho", async () => {
    const { remote, jobId } = await setup([prod(1, [{ pt: "Cor" }, { pt: "Tam" }])]);
    remote.failProduct = true;
    await run(remote, jobId);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("error");
    expect(await attrsOf(1)).toEqual(["Cor", "Tam"]);
    expect(await audits()).toMatchObject([{ acao: "lote.propriedades", sucesso: false }]);
  });

  it("dá para reverter: volta aos nomes anteriores (e preserva outros idiomas)", async () => {
    const { remote, jobId } = await setup([prod(1, [{ pt: "Cor", es: "Color" }, { pt: "Tam" }])]);
    await run(remote, jobId);
    expect(await attrsOf(1)).toEqual(["COR", "TAMANHO"]);

    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    const revertItems = await getJobItems(db, revertId);
    expect(revertItems[0]?.changes.product?.attributes).toEqual({ antes: ["COR", "TAMANHO"], depois: ["Cor", "Tam"] });
    await run(remote, revertId);
    expect(remote.puts.at(-1)).toEqual({ id: 1, input: { attributes: [{ pt: "Cor", es: "Color" }, { pt: "Tam" }] } });
    expect(await attrsOf(1)).toEqual(["Cor", "Tam"]);
    expect((await getJob(db, storeId, revertId))?.status).toBe("completed");
  });

  it("findMismatches só reclama quando os nomes de agora diferem do 'antes' do lote", () => {
    const changes = { product: { attributes: { antes: ["Cor", "Tam"], depois: ["COR", "TAMANHO"] } }, variants: [] };
    expect(findMismatches(prod(1, [{ pt: "Cor" }, { pt: "Tam" }]), changes)).toEqual([]);
    expect(findMismatches(prod(1, [{ pt: "COR" }, { pt: "TAMANHO" }]), changes)).toEqual(["propriedades das variações"]);
  });
});

describe("contra o catálogo real da loja (distribuição auditada em 04/10/2026)", () => {
  // [propriedades, produtos]. Cada linha é uma combinação que existe hoje na loja.
  const real: Array<[string[], number]> = [
    [["COR", "TAM"], 67], [["COR", "TAMANHO"], 29], [[], 27], [["Cor", "Tamanho"], 26], [["Cor", "Tam"], 13],
    [["Tamanho", "Cor"], 7], [["Tamanho"], 4], [["TAMANHO", "COR"], 3], [["TAM"], 2], [["TAMANHO", "Cor"], 2],
    [["TAM", "Cor"], 1], [["Cor"], 1], [["TAMANHO", "COR,"], 1], [["cor", "TAMANHO"], 1], [["CORES", "TAMANHO"], 1],
    [["COR", "TAMAMHO"], 1], [["cor", "TAM"], 1], [["Cor", "TAM"], 1],
  ];

  it("renomeia 111 dos 188 produtos e deixa 77 de fora, cada um com motivo", () => {
    let renomeia = 0;
    let fora = 0;
    for (const [atuais, n] of real) {
      const r = planAtributos(atuais);
      if ("depois" in r) renomeia += n;
      else fora += n;
    }
    expect(renomeia + fora).toBe(188);
    expect(renomeia).toBe(111);
    expect(fora).toBe(77);
  });

  it("nunca renomeia ordem invertida nem produto com uma só propriedade", () => {
    for (const [atuais] of real) {
      const r = planAtributos(atuais);
      if (atuais.length !== 2 && "depois" in r) throw new Error(`renomearia ${atuais.join(" | ")}`);
      if (atuais.length === 2 && /^tam/i.test(atuais[0]!) && "depois" in r) throw new Error(`renomearia ordem invertida ${atuais.join(" | ")}`);
    }
  });
});
