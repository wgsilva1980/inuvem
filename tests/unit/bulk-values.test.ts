import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { createRevertJob, findMismatches, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { describeOperation, operationSchema, padronizarCor, padronizarTamanho, padronizarValores, planOperation, type MirrorProduct } from "@/lib/bulk/operations";
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

describe("padronizarCor (inicial maiúscula em cada palavra)", () => {
  it.each([
    ["AZUL CLARO", "Azul Claro"],
    ["Azul claro", "Azul Claro"],
    ["azul marinho", "Azul Marinho"],
    ["OFF WHITE", "Off White"],
    ["PRETA", "Preta"],
    ["natural", "Natural"],
    ["  Verde   claro ", "Verde Claro"],
    ["VERDE DE ÁGUA", "Verde de Água"],
    ["AZUL/BRANCO", "Azul/Branco"],
    ["FÚCSIA", "Fúcsia"],
    ["Azul Claro", "Azul Claro"],
  ])("%j -> %j", (entrada, esperado) => {
    expect(padronizarCor(entrada)).toBe(esperado);
  });
});

describe("padronizarTamanho (maiúsculas; ÚNICO)", () => {
  it.each([
    ["pp", "PP"],
    ["P", "P"],
    ["gg", "GG"],
    ["38", "38"],
    ["p/m", "P/M"],
    ["UNICO", "ÚNICO"],
    ["ÚNICO", "ÚNICO"],
    ["Único", "ÚNICO"],
    ["único", "ÚNICO"],
    [" unico ", "ÚNICO"],
  ])("%j -> %j", (entrada, esperado) => {
    expect(padronizarTamanho(entrada)).toBe(esperado);
  });

  it("tamanho nunca vira 'Pp' ou 'Gg'", () => {
    expect(padronizarTamanho("PP")).toBe("PP");
    expect(padronizarTamanho("Gg")).toBe("GG");
  });
});

describe("padronizarValores (por nome da propriedade)", () => {
  it("usa a regra da propriedade, em qualquer ordem, e não mexe nas outras", () => {
    expect(padronizarValores(["COR", "TAMANHO"], ["AZUL CLARO", "pp"])).toEqual(["Azul Claro", "PP"]);
    expect(padronizarValores(["Tam", "Cor"], ["unico", "OFF WHITE"])).toEqual(["ÚNICO", "Off White"]);
    expect(padronizarValores(["Material", "Cor"], ["ALGODÃO", "PRETO"])).toEqual(["ALGODÃO", "Preto"]);
  });
});

describe("operação 'valores'", () => {
  const op = operationSchema.parse({ type: "valores" });
  const mp = (id: number, attributes: string[], valores: string[][]): MirrorProduct => ({
    id,
    name: `Produto ${id}`,
    published: true,
    categoryIds: [],
    attributes,
    variants: valores.map((values, i) => ({ id: id * 100 + i, sku: null, label: values.join(" / "), price: 1, promotional_price: null, stock_management: false, stock: null, values })),
  });

  it("entra no schema, no formulário e na descrição", () => {
    expect(op).toEqual({ type: "valores" });
    expect(operationFromForm((n) => (n === "tipo" ? "valores" : "")).op).toEqual({ type: "valores" });
    expect(describeOperation(op)).toContain("inicial maiúscula");
  });

  it("planeja só as variantes que mudam, mostrando antes e depois", () => {
    const plan = planOperation(op, [mp(1, ["COR", "TAMANHO"], [["AZUL CLARO", "P"], ["Preto", "UNICO"], ["Branco", "M"]])]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.changes.variants.map((v) => v.values)).toEqual([
      { antes: ["AZUL CLARO", "P"], depois: ["Azul Claro", "P"] },
      { antes: ["Preto", "UNICO"], depois: ["Preto", "ÚNICO"] },
    ]);
    expect(describeChanges(plan.items[0]!.changes, () => "")[0]).toBe("AZUL CLARO / P: valores AZUL CLARO / P → Azul Claro / P");
  });

  it("deixa de fora, com motivo: já padronizado, sem COR/TAMANHO e valores de tamanho diferente", () => {
    const plan = planOperation(op, [
      mp(1, ["Cor", "Tam"], [["Azul Claro", "P"]]),
      mp(2, ["Material"], [["ALGODÃO"]]),
      mp(3, ["Cor", "Tam"], [["Azul"]]),
    ]);
    expect(plan.items).toEqual([]);
    expect(plan.ignorados.map((i) => i.motivo)).toEqual([
      "a grafia dos valores já está padronizada",
      "não tem as propriedades COR ou TAMANHO",
      "a quantidade de valores das variantes não bate com a de propriedades",
    ]);
  });

  it("deixa o produto inteiro de fora se duas variantes ficariam iguais", () => {
    const plan = planOperation(op, [mp(1, ["COR", "TAMANHO"], [["AZUL", "P"], ["Azul", "P"], ["Preto", "M"]])]);
    expect(plan.items).toEqual([]);
    expect(plan.ignorados[0]!.motivo).toContain("duas variantes ficariam iguais");
  });
});

/* ---- "loja" falsa ---- */
class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  puts: Array<{ pid: number; vid: number; input: VariantInput }> = [];
  failVariant: number | null = null;
  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(_id: number, _input: ProductInput): Promise<Product> {
    throw new Error("não deveria mexer no produto");
  }
  async deleteProduct(id: number) {
    this.products.delete(id);
  }
  async updateVariant(pid: number, vid: number, input: VariantInput) {
    this.puts.push({ pid, vid, input });
    if (this.failVariant === vid) throw new NuvemshopError("422", 422, null, "recusado");
    const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
    Object.assign(v, input);
    return structuredClone(v);
  }
}

const mkVariant = (id: number, pid: number, values: I18n[]): Variant => ({ id, product_id: pid, sku: `S${id}`, price: "100.00", stock_management: false, stock: null, values });
const mkProduct = (): Product => ({
  id: 1,
  name: { pt: "Blusa" },
  published: true,
  categories: [],
  attributes: [{ pt: "COR" }, { pt: "TAMANHO" }],
  variants: [mkVariant(10, 1, [{ pt: "AZUL CLARO", es: "Azul claro" }, { pt: "UNICO" }]), mkVariant(11, 1, [{ pt: "Preto" }, { pt: "pp" }]), mkVariant(12, 1, [{ pt: "Branco" }, { pt: "M" }])],
  updated_at: "2026-10-01T10:00:00+0000",
});

const valoresNoEspelho = async () => (await loadMirrorProducts(db, storeId, [1]))[0]!.variants.map((v) => v.values);
const audits = async () => (await pg.query("SELECT acao, entidade_id, sucesso, antes, depois FROM audit_log WHERE acao LIKE 'lote.%' AND acao <> 'lote.criar' ORDER BY id")).rows as Array<Record<string, unknown>>;

async function setup() {
  const remote = new FakeStore([mkProduct()]);
  await upsertProducts(db, storeId, [mkProduct()]);
  const op = operationSchema.parse({ type: "valores" });
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, [1]));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: describeOperation(op), plan });
  return { remote, plan, jobId };
}
const run = async (remote: FakeStore, jobId: string) => {
  await startJob(db, storeId, jobId);
  return stepJob(db, remote, { storeId, actor, jobId, budgetMs: 10_000 });
};

describe("executando o lote de valores", () => {
  it("troca só os valores que mudam, preserva outros idiomas, regrava o espelho e registra", async () => {
    const { remote, plan, jobId } = await setup();
    expect(plan.items[0]!.changes.variants.map((v) => v.id)).toEqual([10, 11]); // a 12 já está padronizada
    expect(await run(remote, jobId)).toMatchObject({ done: true, status: "completed" });
    expect(remote.puts).toEqual([
      { pid: 1, vid: 10, input: { values: [{ pt: "Azul Claro", es: "Azul claro" }, { pt: "ÚNICO" }] } },
      { pid: 1, vid: 11, input: { values: [{ pt: "Preto" }, { pt: "PP" }] } },
    ]);
    expect(await valoresNoEspelho()).toEqual([["Azul Claro", "ÚNICO"], ["Preto", "PP"], ["Branco", "M"]]);
    expect(await audits()).toMatchObject([{ acao: "lote.valores", entidade_id: "1", sucesso: true, depois: { variantes: { "10": { valores: ["Azul Claro", "ÚNICO"] } } } }]);
  });

  it("se a loja mudou os valores depois da pré-visualização, não altera e marca conflito", async () => {
    const { remote, jobId } = await setup();
    remote.products.get(1)!.variants![0]!.values = [{ pt: "AZUL" }, { pt: "UNICO" }];
    await run(remote, jobId);
    expect(remote.puts).toEqual([]);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("conflict");
    expect(item?.resultado?.mensagem).toContain("valores de");
  });

  it("recusa da loja numa variante: o item fica com erro e as outras partes não rodam", async () => {
    const { remote, jobId } = await setup();
    remote.failVariant = 10;
    await run(remote, jobId);
    const [item] = await getJobItems(db, jobId);
    expect(item?.status).toBe("error");
    expect(remote.puts.map((p) => p.vid)).toEqual([10]);
    expect(await valoresNoEspelho()).toEqual([["AZUL CLARO", "UNICO"], ["Preto", "pp"], ["Branco", "M"]]);
  });

  it("dá para reverter para a grafia anterior (e preservar outros idiomas)", async () => {
    const { remote, jobId } = await setup();
    await run(remote, jobId);
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await run(remote, revertId);
    expect(remote.puts.slice(-2)).toEqual([
      { pid: 1, vid: 10, input: { values: [{ pt: "AZUL CLARO", es: "Azul claro" }, { pt: "UNICO" }] } },
      { pid: 1, vid: 11, input: { values: [{ pt: "Preto" }, { pt: "pp" }] } },
    ]);
    expect(await valoresNoEspelho()).toEqual([["AZUL CLARO", "UNICO"], ["Preto", "pp"], ["Branco", "M"]]);
  });

  it("findMismatches compara os valores de agora com o 'antes' do lote", () => {
    const changes = { variants: [{ id: 10, label: "x", sku: null, values: { antes: ["AZUL CLARO", "UNICO"], depois: ["Azul Claro", "ÚNICO"] } }] };
    expect(findMismatches(mkProduct(), changes)).toEqual([]);
    expect(findMismatches({ ...mkProduct(), variants: [mkVariant(10, 1, [{ pt: "Azul Claro" }, { pt: "ÚNICO" }])] }, changes)).toEqual(['valores de "x"']);
  });
});
