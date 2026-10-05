import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";
import { buildRevertChanges, createRevertJob, findMismatches, runItem, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { operationSchema, planOperation } from "@/lib/bulk/operations";
import { cancelJob, claimItems, createJob, getJob, getJobCounts, getJobItems, listJobs, loadMirrorProducts, startJob, JobStateError } from "@/lib/bulk/repo";
import { listProductIds } from "@/lib/catalog/query";
import { contextoSku, proximosSkus } from "@/lib/catalog/sku";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
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
  const { rows } = await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id");
  storeId = rows[0]!.id;
});

/* ---- "loja" falsa: guarda o estado dos produtos e simula a API ---- */
class FakeStore implements BulkApi {
  products = new Map<number, Product>();
  calls: string[] = [];
  failOn: { variantId?: number; product?: boolean } = {};
  notFound = new Set<number>();

  constructor(list: Product[]) {
    for (const p of list) this.products.set(p.id, structuredClone(p));
  }
  async getProduct(id: number) {
    this.calls.push(`GET ${id}`);
    if (this.notFound.has(id)) throw new NuvemshopError("404", 404, null);
    return structuredClone(this.products.get(id)!);
  }
  async updateProduct(id: number, input: ProductInput) {
    this.calls.push(`PUT product ${id} ${JSON.stringify(input)}`);
    if (this.failOn.product) throw new NuvemshopError("422", 422, null, "recusado");
    const p = this.products.get(id)!;
    if (input.published !== undefined) p.published = input.published;
    if (input.categories) p.categories = input.categories.map((c) => ({ id: c, name: { pt: `Cat ${c}` } }));
    return structuredClone(p);
  }
  async deleteProduct(id: number) {
    this.products.delete(id);
  }
  async updateVariant(pid: number, vid: number, input: VariantInput) {
    this.calls.push(`PUT variant ${vid} ${JSON.stringify(input)}`);
    if (this.failOn.variantId === vid) throw new NuvemshopError("422", 422, null, "recusado");
    const v = this.products.get(pid)!.variants!.find((x) => x.id === vid)!;
    Object.assign(v, input);
    return structuredClone(v);
  }
}

const variant = (id: number, productId: number, over: Partial<Variant> = {}): Variant => ({
  id,
  product_id: productId,
  sku: `S${id}`,
  price: "100.00",
  stock_management: true,
  stock: 10,
  values: [{ pt: `V${id}` }],
  ...over,
});
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
  await upsertCategories(db, storeId, [{ id: 1, name: { pt: "Cat 1" } }, { id: 2, name: { pt: "Cat 2" } }] as Category[]);
  await upsertProducts(db, storeId, list);
  return new FakeStore(list);
}

async function newJob(opInput: unknown, ids: number[]) {
  const op = operationSchema.parse(opInput);
  const plan = planOperation(op, await loadMirrorProducts(db, storeId, ids));
  const jobId = await createJob(db, { storeId, actor, operation: op, descricao: "teste", plan });
  return { jobId, plan };
}

const run = async (api: BulkApi, jobId: string, budgetMs = 10_000) => stepJob(db, api, { storeId, actor, jobId, budgetMs });
const mirrorPrice = async (id: number) => (await pg.query<{ price: string }>("SELECT price::text AS price FROM variants WHERE id = $1", [id])).rows[0]!.price;
const audits = async () => (await pg.query("SELECT acao, entidade_id, sucesso, antes, depois FROM audit_log ORDER BY id")).rows as Array<Record<string, unknown>>;

describe("pré-visualização e seleção", () => {
  it("carrega o espelho com rótulos de variação e cria o lote com itens e ignorados", async () => {
    await setup([product(1), product(2, { variants: [variant(21, 2, { price: "0.00" })] })]);
    const { jobId, plan } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1, 2]);
    expect(plan.items.map((i) => i.productId)).toEqual([1]); // o 2 tem preço zero: ignorado
    expect(plan.ignorados[0]).toMatchObject({ productId: 2 });
    const job = (await getJob(db, storeId, jobId))!;
    expect(job.status).toBe("preview");
    expect(await getJobCounts(db, jobId)).toMatchObject({ total: 1, pending: 1, variants: 2 });
    expect((await getJobItems(db, jobId))[0]!.changes.variants[0]!.label).toBe("V10");
    expect((await listJobs(db, storeId))[0]!.id).toBe(jobId);
  });

  it("seleciona produtos por filtro, com limite", async () => {
    await setup([product(1), product(2, { published: false }), product(3)]);
    expect((await listProductIds(db, storeId, { status: "publicados" }, 10)).ids).toEqual([1, 3]);
    expect(await listProductIds(db, storeId, {}, 2)).toEqual({ ids: [1, 2], truncated: true });
  });
});

describe("execução", () => {
  it("só começa depois de confirmar (preview -> running) e não roda sem isso", async () => {
    const api = await setup([product(1)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1]);
    expect(await run(api, jobId)).toMatchObject({ done: true, status: "preview", processed: 0 });
    expect(api.calls).toEqual([]);
    await startJob(db, storeId, jobId);
    await expect(startJob(db, storeId, jobId)).rejects.toBeInstanceOf(JobStateError);
  });

  it("aplica o preço na loja, atualiza o espelho, conclui o lote e registra cada produto", async () => {
    const api = await setup([product(1), product(2)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1, 2]);
    await startJob(db, storeId, jobId);
    expect(await run(api, jobId)).toMatchObject({ done: true, status: "completed", processed: 2 });

    expect(api.products.get(1)!.variants!.map((v) => v.price)).toEqual(["110.00", "110.00"]);
    expect(await mirrorPrice(10)).toBe("110.00");
    expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 2, error: 0, conflict: 0, pending: 0 });
    expect((await getJob(db, storeId, jobId))!.status).toBe("completed");
    const log = await audits();
    expect(log).toHaveLength(2);
    expect(log.map((l) => l.entidade_id)).toEqual(["1", "2"]); // processados na ordem da pré-visualização
    expect(log[0]).toMatchObject({ acao: "lote.preco", entidade_id: "1", sucesso: true });
    expect(log[0]!.antes).toMatchObject({ lote: jobId, variantes: { "10": { preco: "100.00" } } });
    expect(log[0]!.depois).toMatchObject({ variantes: { "10": { preco: "110.00" } } });
  });

  it("estoque, publicar e categoria vão para a loja", async () => {
    const api = await setup([product(1)]);
    for (const [op, check] of [
      [{ type: "estoque", mode: "somar", value: 5 }, () => api.products.get(1)!.variants!.map((v) => v.stock)],
      [{ type: "publicar", published: false }, () => api.products.get(1)!.published],
      [{ type: "categoria", mode: "adicionar", categoryId: 2 }, () => api.products.get(1)!.categories!.map((c) => c.id)],
    ] as const) {
      const { jobId } = await newJob(op, [1]);
      await startJob(db, storeId, jobId);
      await run(api, jobId);
      expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 1 });
      if (op.type === "estoque") expect(check()).toEqual([15, 15]);
      if (op.type === "publicar") expect(check()).toBe(false);
      if (op.type === "categoria") expect(check()).toEqual([1, 2]);
    }
    expect((await pg.query("SELECT published FROM products WHERE id = 1")).rows[0]).toEqual({ published: false });
  });

  it("CONFLITO: se a loja mudou desde a pré-visualização, não altera nada naquele produto", async () => {
    const api = await setup([product(1), product(2)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1, 2]);
    api.products.get(1)!.variants![0]!.price = "95.00"; // alguém mexeu na loja
    await startJob(db, storeId, jobId);
    await run(api, jobId);

    expect(api.calls.some((c) => c.startsWith("PUT") && c.includes(" 10 "))).toBe(false);
    expect(api.products.get(1)!.variants!.map((v) => v.price)).toEqual(["95.00", "100.00"]); // nada mexido, nem a variante 11
    expect(api.products.get(2)!.variants!.map((v) => v.price)).toEqual(["110.00", "110.00"]); // o outro produto segue
    expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 1, conflict: 1 });
    expect(await mirrorPrice(10)).toBe("95.00"); // espelho passou a refletir a loja
    const [c] = await getJobItems(db, jobId, { onlyProblems: true });
    expect(c!.resultado!.mensagem).toMatch(/A loja mudou.*preço de "V10".*Nada foi alterado/);
    expect((await audits()).find((a) => a.entidade_id === "1")).toMatchObject({ sucesso: false });
  });

  it("falha no meio: registra o que foi aplicado, para na primeira falha e o resto não é tentado", async () => {
    const api = await setup([product(1, { variants: [variant(10, 1), variant(11, 1), variant(12, 1)] })]);
    api.failOn = { variantId: 11 };
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1]);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    const [item] = await getJobItems(db, jobId);
    expect(item!.status).toBe("error");
    expect(item!.resultado!.partes).toEqual([
      { tipo: "variante", id: 10, ok: true },
      { tipo: "variante", id: 11, ok: false, erro: expect.stringMatching(/recusou/i) },
      { tipo: "variante", id: 12, ok: false, erro: expect.stringMatching(/não executado/) },
    ]);
    expect(api.products.get(1)!.variants!.map((v) => v.price)).toEqual(["110.00", "100.00", "100.00"]);
    expect(await mirrorPrice(10)).toBe("110.00"); // o espelho reflete o parcial
    expect((await getJob(db, storeId, jobId))!.status).toBe("completed");
  });

  it("produto apagado na loja vira erro, sem travar o lote", async () => {
    const api = await setup([product(1), product(2)]);
    api.notFound.add(1);
    const { jobId } = await newJob({ type: "publicar", published: false }, [1, 2]);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 1, error: 1 });
    expect((await getJobItems(db, jobId, { onlyProblems: true }))[0]!.resultado!.mensagem).toMatch(/não existe mais/);
  });

  it("retoma em passos curtos e nunca processa o mesmo produto duas vezes", async () => {
    const list = Array.from({ length: 7 }, (_, i) => product(i + 1));
    const api = await setup(list);
    const { jobId } = await newJob({ type: "preco", mode: "valor", value: 1 }, list.map((p) => p.id));
    await startJob(db, storeId, jobId);
    let t = 0;
    const clock = () => (t += 500); // cada leitura do relógio avança 0,5 s: o orçamento acaba logo
    let steps = 0;
    for (;;) {
      const r = await stepJob(db, api, { storeId, actor, jobId, budgetMs: 1500, batch: 2, now: clock });
      steps++;
      if (r.done) break;
      expect(steps).toBeLessThan(20);
    }
    expect(steps).toBeGreaterThan(1);
    expect(api.calls.filter((c) => c.startsWith("PUT variant")).length).toBe(14); // 7 produtos x 2 variantes, uma vez cada
    expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 7, pending: 0 });
  });

  it("itens travados há mais de 2 minutos são retomados; recém-pegos não", async () => {
    await setup([product(1), product(2)]);
    const { jobId } = await newJob({ type: "publicar", published: false }, [1, 2]);
    await startJob(db, storeId, jobId);
    expect(await claimItems(db, jobId, 5)).toHaveLength(2);
    expect(await claimItems(db, jobId, 5)).toHaveLength(0); // já estão em processamento
    await pg.query("UPDATE bulk_job_items SET claimed_at = now() - interval '3 minutes' WHERE seq = 1");
    expect((await claimItems(db, jobId, 5)).map((i) => i.seq)).toEqual([1]);
  });

  it("claimItems devolve sempre na ordem da pré-visualização", async () => {
    await setup([product(1), product(2), product(3), product(4)]);
    const { jobId } = await newJob({ type: "publicar", published: false }, [1, 2, 3, 4]);
    await startJob(db, storeId, jobId);
    for (let i = 0; i < 5; i++) {
      await pg.query("UPDATE bulk_job_items SET status = 'pending', claimed_at = NULL WHERE job_id = $1", [jobId]);
      expect((await claimItems(db, jobId, 4)).map((x) => x.seq)).toEqual([1, 2, 3, 4]);
    }
  });

  it("só um lote em execução por loja; cancelar interrompe", async () => {
    const api = await setup([product(1), product(2)]);
    const a = await newJob({ type: "publicar", published: false }, [1]);
    const b = await newJob({ type: "publicar", published: false }, [2]);
    await startJob(db, storeId, a.jobId);
    await expect(startJob(db, storeId, b.jobId)).rejects.toThrow(/Já existe um lote em execução/);
    expect(await cancelJob(db, storeId, a.jobId)).toBe(true);
    expect(await run(api, a.jobId)).toMatchObject({ done: true, status: "cancelled", processed: 0 });
    expect(api.calls).toEqual([]);
    await startJob(db, storeId, b.jobId); // agora pode
  });

  it("não enxerga lote de outra loja", async () => {
    await setup([product(1)]);
    const { jobId } = await newJob({ type: "publicar", published: false }, [1]);
    const other = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (2, 'y') RETURNING id")).rows[0]!.id;
    expect(await getJob(db, other, jobId)).toBeNull();
    await expect(startJob(db, other, jobId)).rejects.toBeInstanceOf(JobStateError);
    expect(await cancelJob(db, other, jobId)).toBe(false);
  });
});

describe("conferência (findMismatches)", () => {
  const changes = { variants: [{ id: 10, label: "V10", sku: null, price: { antes: "100.00", depois: "110.00" }, stock: { antes: 10, depois: 12 } }] };
  it("passa quando a loja está como o 'antes' (preço comparado como número)", () => {
    expect(findMismatches(product(1, { variants: [variant(10, 1, { price: "100" })] }), changes)).toEqual([]);
    expect(findMismatches(product(1, { variants: [variant(10, 1, { price: 100 })] }), changes)).toEqual([]);
  });
  it("aponta preço, estoque e variante que sumiu", () => {
    expect(findMismatches(product(1, { variants: [variant(10, 1, { price: "90.00", stock: 3 })] }), changes)).toEqual(['preço de "V10"', 'estoque de "V10"']);
    expect(findMismatches(product(1, { variants: [] }), changes)).toEqual(['variante "V10" não existe mais']);
    expect(findMismatches(product(1, { variants: [variant(10, 1, { stock_management: false, stock: null })] }), changes)[0]).toMatch(/controle desligado/);
  });
  it("confere publicado e categorias", () => {
    const ch = { product: { published: { antes: true, depois: false }, categories: { antes: [1], depois: [1, 2] } }, variants: [] };
    expect(findMismatches(product(1), ch)).toEqual([]);
    expect(findMismatches(product(1, { published: false, categories: [{ id: 5, name: { pt: "x" } }] }), ch)).toEqual(["situação (publicado)", "categorias"]);
  });
});

describe("reverter", () => {
  it("desfaz o lote (preço) e o espelho/loja voltam ao original; só uma vez", async () => {
    const api = await setup([product(1), product(2)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1, 2]);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    expect(await mirrorPrice(10)).toBe("110.00");

    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    const revert = (await getJob(db, storeId, revertId))!;
    expect(revert).toMatchObject({ status: "preview", reverts_job_id: jobId, descricao: "Reverter: teste" });
    await startJob(db, storeId, revertId);
    await run(api, revertId);
    expect(api.products.get(1)!.variants!.map((v) => v.price)).toEqual(["100.00", "100.00"]);
    expect(await mirrorPrice(10)).toBe("100.00");
    expect((await audits()).some((a) => a.acao === "lote.reverter")).toBe(true);

    await expect(createRevertJob(db, { storeId, actor, jobId })).rejects.toThrow(/já foi revertido/);
    await expect(createRevertJob(db, { storeId, actor, jobId: revertId })).rejects.toThrow(/reversão não pode ser revertido/);
  });

  it("reverter confere a loja: se mudou depois do lote, dá conflito e não sobrescreve", async () => {
    const api = await setup([product(1)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1]);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    api.products.get(1)!.variants![0]!.price = "130.00"; // mexeram depois do lote
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await startJob(db, storeId, revertId);
    await run(api, revertId);
    expect(await getJobCounts(db, revertId)).toMatchObject({ conflict: 1, ok: 0 });
    expect(api.products.get(1)!.variants![0]!.price).toBe("130.00");
  });

  it("em lote parcial, reverte só o que foi aplicado", async () => {
    const api = await setup([product(1, { variants: [variant(10, 1), variant(11, 1)] })]);
    api.failOn = { variantId: 11 };
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1]);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    api.failOn = {};
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    const items = await getJobItems(db, revertId);
    expect(items[0]!.changes.variants.map((v) => v.id)).toEqual([10]); // a 11 nunca foi alterada
  });

  it("não reverte lote sem alterações aplicadas nem lote ainda em pré-visualização", async () => {
    const api = await setup([product(1)]);
    const { jobId } = await newJob({ type: "preco", mode: "percentual", value: 10 }, [1]);
    await expect(createRevertJob(db, { storeId, actor, jobId })).rejects.toThrow(/terminou ou foi cancelado/);
    api.products.get(1)!.variants![0]!.price = "1.00";
    await startJob(db, storeId, jobId);
    await run(api, jobId); // conflito: nada aplicado
    await expect(createRevertJob(db, { storeId, actor, jobId })).rejects.toThrow(/não aplicou nenhuma alteração/);
  });

  it("buildRevertChanges: estoque que era 'sem quantidade' volta para 0", () => {
    const changes = { variants: [{ id: 1, label: "x", sku: null, stock: { antes: null, depois: 5 } }] };
    const r = buildRevertChanges(changes, { partes: [{ tipo: "variante", id: 1, ok: true }] });
    expect(r!.variants[0]!.stock).toEqual({ antes: 5, depois: 0 });
    expect(buildRevertChanges(changes, { partes: [{ tipo: "variante", id: 1, ok: false }] })).toBeNull();
    expect(buildRevertChanges(changes, null)).toBeNull();
  });
});

describe("runItem isolado", () => {
  it("falha no PUT do produto: não toca nas variantes", async () => {
    const api = await setup([product(1)]);
    api.failOn = { product: true };
    const op = operationSchema.parse({ type: "publicar", published: false });
    const plan = planOperation(op, await loadMirrorProducts(db, storeId, [1]));
    const jobId = await createJob(db, { storeId, actor, operation: op, descricao: "x", plan });
    await startJob(db, storeId, jobId);
    const job = (await getJob(db, storeId, jobId))!;
    const [item] = await claimItems(db, jobId, 1);
    expect(await runItem(db, api, { storeId, actor, job }, item!)).toBe("error");
    expect(api.products.get(1)!.published).toBe(true);
  });
});

describe("excluir produtos em lote", () => {
  it("exclui na loja, tira do espelho, registra e não tem reversão", async () => {
    const api = await setup([product(1), product(2), product(3)]);
    const { jobId, plan } = await newJob({ type: "excluir" }, [1, 2]);
    expect(plan.items.map((i) => i.productId)).toEqual([1, 2]);
    await startJob(db, storeId, jobId);
    expect(await run(api, jobId)).toMatchObject({ done: true, status: "completed" });
    expect([...api.products.keys()]).toEqual([3]);
    expect((await pg.query("SELECT id FROM products")).rows).toEqual([{ id: 3 }]);
    expect((await pg.query("SELECT count(*)::int AS n FROM variants WHERE product_id IN (1, 2)")).rows[0]).toEqual({ n: 0 });
    expect((await audits()).filter((a) => a.acao === "lote.excluir")).toHaveLength(2);
    await expect(createRevertJob(db, { storeId, actor, jobId })).rejects.toThrow(/não podem ser restaurados/);
  });

  it("produto renomeado na loja depois da pré-visualização fica de fora (conflito)", async () => {
    const api = await setup([product(1, { name: { pt: "Vestido" } })]);
    const { jobId } = await newJob({ type: "excluir" }, [1]);
    api.products.get(1)!.name = { pt: "Outro nome" };
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    expect(api.products.has(1)).toBe(true);
    expect(await getJobCounts(db, jobId)).toMatchObject({ conflict: 1, ok: 0 });
  });

  it("produto que já não existe na loja conta como excluído e sai do espelho", async () => {
    const api = await setup([product(1)]);
    const { jobId } = await newJob({ type: "excluir" }, [1]);
    api.notFound.add(1);
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    expect(await getJobCounts(db, jobId)).toMatchObject({ ok: 1 });
    expect((await pg.query("SELECT id FROM products")).rows).toEqual([]);
  });
});

describe("ajustar SKUs em lote", () => {
  const comSku = (id: number, skus: Array<string | null>) =>
    product(id, { variants: skus.map((s, i) => variant(id * 10 + i, id, { sku: s, values: [{ pt: `V${i}` }] })) });

  it("numera os vazios e renumera os repetidos (o mais antigo fica), na sequência da loja", async () => {
    const api = await setup([comSku(1, ["100", "101"]), comSku(2, ["101", null]), comSku(3, ["200", "200"])]);
    const op = operationSchema.parse({ type: "sku" });
    const plan = planOperation(op, await loadMirrorProducts(db, storeId, [1, 2, 3]), await contextoSku(db, storeId));
    const novos = plan.items.flatMap((i) => i.changes.variants.map((v) => [v.id, v.skuNovo]));
    expect(novos).toEqual([
      [20, { antes: "101", depois: "201" }],
      [21, { antes: null, depois: "202" }],
      [31, { antes: "200", depois: "203" }],
    ]);
    expect(plan.ignorados.map((i) => i.productId)).toEqual([1]); // produto 1 já está certo

    const jobId = await createJob(db, { storeId, actor, operation: op, descricao: "t", plan });
    await startJob(db, storeId, jobId);
    await run(api, jobId);
    const skus = (await pg.query<{ id: string; sku: string }>("SELECT id::text AS id, sku FROM variants ORDER BY id")).rows.map((r) => [r.id, r.sku]);
    expect(skus).toEqual([["10", "100"], ["11", "101"], ["20", "201"], ["21", "202"], ["30", "200"], ["31", "203"]]);

    // reverter volta o código antigo (vazio vira "")
    const revertId = await createRevertJob(db, { storeId, actor, jobId });
    await startJob(db, storeId, revertId);
    await run(api, revertId);
    expect((await pg.query<{ sku: string }>("SELECT sku FROM variants WHERE id IN (20, 21) ORDER BY id")).rows.map((r) => r.sku)).toEqual(["101", ""]);
  });

  it("proximosSkus continua do maior número da loja", async () => {
    await setup([comSku(1, ["100", "101"]), comSku(2, ["abc", null])]);
    expect(await proximosSkus(db, storeId, 3)).toEqual(["102", "103", "104"]);
  });
});
