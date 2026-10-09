import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import type { BulkApi } from "@/lib/bulk/engine";
import { createJob, startJob } from "@/lib/bulk/repo";
import { operationSchema } from "@/lib/bulk/operations";
import { avancarPromocao, tickPromocoes } from "@/lib/promotions/engine";
import { PromocaoError, cancelPromotion, createPromotion, getPromotion, listDue } from "@/lib/promotions/repo";
import type { Category, Product, ProductInput, Variant, VariantInput } from "@/lib/nuvemshop/types";

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

class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(id: number, _input: ProductInput) {
    return structuredClone(this.products.get(id)!);
  }
  async deleteProduct(id: number) {
    this.products.delete(id);
  }
  async updateVariant(pid: number, vid: number, input: VariantInput) {
    const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
    Object.assign(v, input);
    return structuredClone(v);
  }
  promo(pid: number, vid: number) {
    return this.products.get(pid)!.variants!.find((x) => x.id === vid)!.promotional_price ?? null;
  }
}

const variant = (id: number, productId: number, over: Partial<Variant> = {}): Variant => ({ id, product_id: productId, sku: `S${id}`, price: "100.00", stock_management: true, stock: 10, values: [{ pt: `V${id}` }], ...over });
const product = (id: number, over: Partial<Product> = {}): Product => ({
  id,
  name: { pt: `Produto ${id}` },
  published: true,
  categories: [{ id: 1, name: { pt: "Cat 1" } }],
  variants: [variant(id * 10, id), variant(id * 10 + 1, id)],
  updated_at: "2026-10-01T10:00:00+0000",
  ...over,
});

async function setup(list: Product[]) {
  await upsertCategories(db, storeId, [{ id: 1, name: { pt: "Cat 1" } }] as Category[]);
  await upsertProducts(db, storeId, list);
  return new FakeStore(list);
}

const op = operationSchema.parse({ type: "promocao", mode: "desconto", percent: 20, rounding: "nenhum" });
const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 16); // "horário de Brasília" (UTC-3)

const criar = (over: Partial<Parameters<typeof createPromotion>[1]> = {}) =>
  createPromotion(db, { storeId, actor, nome: "Verão", operation: op, productIds: [1, 2], inicioLocal: futuro(1), fimLocal: futuro(3), ...over });

const passo = (api: BulkApi, id: string, acao?: "iniciar" | "encerrar") => avancarPromocao(db, api, { storeId, actor, id, acao, budgetMs: 10_000 });
const andar = async (api: BulkApi, id: string, acao?: "iniciar" | "encerrar") => {
  let r = await passo(api, id, acao);
  for (let i = 0; i < 20 && !r.done; i++) r = await passo(api, id);
  return r;
};

describe("agenda da promoção", () => {
  it("valida nome, datas e operação", async () => {
    await expect(criar({ nome: "  " })).rejects.toThrow(PromocaoError);
    await expect(criar({ inicioLocal: futuro(3), fimLocal: futuro(1) })).rejects.toThrow(/depois do início/);
    await expect(criar({ inicioLocal: futuro(-5), fimLocal: futuro(-2) })).rejects.toThrow(/já passou/);
    await expect(criar({ inicioLocal: "amanhã", fimLocal: futuro(2) })).rejects.toThrow(/início e o fim/);
    await expect(criar({ productIds: [] })).rejects.toThrow(/Nenhum produto/);
  });

  it("interpreta as datas no horário de Brasília", async () => {
    const id = await criar({ inicioLocal: "2099-01-10T09:00", fimLocal: "2099-01-12T09:00" });
    expect((await getPromotion(db, storeId, id))!.starts_at).toContain("2099-01-10 12:00:00");
  });

  it("recusa produto que já está em outra promoção no mesmo período, mas aceita em outro período", async () => {
    await criar({ inicioLocal: futuro(1), fimLocal: futuro(3) });
    await expect(criar({ productIds: [2, 9], inicioLocal: futuro(2), fimLocal: futuro(4) })).rejects.toThrow(/se sobrepõe/);
    await expect(criar({ productIds: [3], inicioLocal: futuro(2), fimLocal: futuro(4) })).resolves.toBeTruthy();
    await expect(criar({ inicioLocal: futuro(5), fimLocal: futuro(6) })).resolves.toBeTruthy();
  });

  it("só cancela a que ainda não começou", async () => {
    const id = await criar();
    expect(await cancelPromotion(db, storeId, id)).toBe(true);
    expect(await cancelPromotion(db, storeId, id)).toBe(false);
    expect((await getPromotion(db, storeId, id))!.status).toBe("cancelada");
    // cancelada libera os produtos
    await expect(criar()).resolves.toBeTruthy();
  });
});

describe("ciclo: iniciar, no ar, encerrar", () => {
  it("aplica o desconto na loja e depois restaura o preço promocional de antes", async () => {
    const loja = await setup([product(1), product(2, { variants: [variant(20, 2, { promotional_price: "90.00" })] })]);
    const id = await criar();

    expect((await andar(loja, id, "iniciar")).status).toBe("ativa");
    expect(loja.promo(1, 10)).toBe("80.00");
    expect(loja.promo(2, 20)).toBe("80.00");
    const ativa = (await getPromotion(db, storeId, id))!;
    expect(ativa.apply_job_id).toBeTruthy();
    expect(ativa.started_at).toBeTruthy();

    expect((await andar(loja, id, "encerrar")).status).toBe("encerrada");
    expect(loja.promo(1, 10)).toBeNull();
    expect(loja.promo(2, 20)).toBe("90.00"); // voltou ao que era, não a vazio
    const fim = (await getPromotion(db, storeId, id))!;
    expect(fim.revert_job_id).toBeTruthy();
    expect(fim.ended_at).toBeTruthy();
    const acoes = (await pg.query<{ acao: string }>("SELECT acao FROM audit_log WHERE entidade = 'promocao' ORDER BY id")).rows.map((r) => r.acao);
    expect(acoes).toEqual(["promocao.iniciar", "promocao.no_ar", "promocao.encerrar", "promocao.encerrada"]);
  });

  it("não sobrescreve um preço que foi mudado na loja durante a promoção", async () => {
    const loja = await setup([product(1)]);
    const id = await criar({ productIds: [1] });
    await andar(loja, id, "iniciar");
    loja.products.get(1)!.variants![0]!.promotional_price = "55.00"; // alguém editou na loja
    const r = await andar(loja, id, "encerrar");
    expect(r.status).toBe("encerrada");
    expect(loja.promo(1, 10)).toBe("55.00"); // preservado
    expect(r.counts!.conflict + r.counts!.error).toBeGreaterThan(0);
  });

  it("promoção sem nada a alterar encerra sem tocar na loja", async () => {
    const loja = await setup([product(1, { variants: [variant(10, 1, { price: "0.00" })] })]);
    const id = await criar({ productIds: [1] });
    const r = await andar(loja, id, "iniciar");
    expect(r.status).toBe("encerrada");
    expect(r.nota).toMatch(/Nada a alterar/);
  });

  it("outro lote em execução impede o início e a promoção continua agendada", async () => {
    const loja = await setup([product(1)]);
    const jobId = await createJob(db, { storeId, actor, operation: op, descricao: "outro", plan: { items: [], ignorados: [] } });
    await startJob(db, storeId, jobId);
    const id = await criar({ productIds: [1] });
    await expect(passo(loja, id, "iniciar")).rejects.toThrow(/lote em execução/);
    expect((await getPromotion(db, storeId, id))!.status).toBe("agendada");
  });

  it("'iniciar' repetido ou 'encerrar' antes da hora não faz nada", async () => {
    const loja = await setup([product(1)]);
    const id = await criar({ productIds: [1] });
    expect((await passo(loja, id, "encerrar")).status).toBe("agendada");
    await andar(loja, id, "iniciar");
    expect((await passo(loja, id, "iniciar")).status).toBe("ativa");
  });
});

describe("cron (tick)", () => {
  const vencer = (id: string, campo: "starts_at" | "ends_at", quando: string) => pg.query(`UPDATE promotions SET ${campo} = ${quando} WHERE id = $1`, [id]);

  it("começa a que chegou na hora e encerra a que venceu", async () => {
    const loja = await setup([product(1), product(2)]);
    const a = await criar({ productIds: [1], inicioLocal: futuro(1), fimLocal: futuro(5) });
    const b = await criar({ productIds: [2], inicioLocal: futuro(1), fimLocal: futuro(5) });
    expect(await listDue(db, storeId)).toHaveLength(0);

    await pg.query("UPDATE promotions SET starts_at = now() - interval '2 hours' WHERE id = $1", [a]);
    await tickPromocoes(db, loja, { storeId, budgetMs: 20_000 });
    expect((await getPromotion(db, storeId, a))!.status).toBe("ativa");
    expect((await getPromotion(db, storeId, b))!.status).toBe("agendada");
    expect(loja.promo(1, 10)).toBe("80.00");
    expect(loja.promo(2, 20)).toBeNull();

    await pg.query("UPDATE promotions SET starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' WHERE id = $1", [a]);
    await tickPromocoes(db, loja, { storeId, budgetMs: 20_000 });
    expect((await getPromotion(db, storeId, a))!.status).toBe("encerrada");
    expect(loja.promo(1, 10)).toBeNull();
  });

  it("promoção que venceu sem nunca começar é encerrada sem mexer na loja", async () => {
    const loja = await setup([product(1)]);
    const a = await criar({ productIds: [1] });
    await pg.query("UPDATE promotions SET starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' WHERE id = $1", [a]);
    await tickPromocoes(db, loja, { storeId, budgetMs: 20_000 });
    const p = (await getPromotion(db, storeId, a))!;
    expect(p.status).toBe("encerrada");
    expect(p.nota).toMatch(/prazo acabou/);
    expect(loja.promo(1, 10)).toBeNull();
  });

  it("continua uma promoção que ficou pela metade quando o tempo acabou", async () => {
    const loja = await setup([product(1), product(2), product(3), product(4)]);
    const a = await criar({ productIds: [1, 2, 3, 4] });
    let t = 0;
    const r = await avancarPromocao(db, loja, { storeId, actor, id: a, acao: "iniciar", budgetMs: 5, now: () => (t += 10) });
    expect(r.status).toBe("aplicando");
    expect(r.done).toBe(false);
    await tickPromocoes(db, loja, { storeId, budgetMs: 20_000 });
    expect((await getPromotion(db, storeId, a))!.status).toBe("ativa");
    expect([10, 20, 30, 40].map((v) => loja.promo(v / 10, v))).toEqual(["80.00", "80.00", "80.00", "80.00"]);
  });
});
