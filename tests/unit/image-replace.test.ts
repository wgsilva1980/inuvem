import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { medirPendentes, type Medida } from "@/lib/images/audit";
import { desfazerProduto, padronizarPendentes, produtosPendentes, trocarImagem, type ReplaceApi, type ReplaceDeps } from "@/lib/images/replace";
import type { BackupStorage } from "@/lib/images/storage";
import type { Product, ProductImage, Variant } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const img = (id: number, position: number, product_id = 1): ProductImage => ({ id, product_id, src: `https://x/${id}.jpg`, position }) as ProductImage;
const variant = (id: number, image_id: number | null): Variant => ({ id, product_id: 1, price: "10.00", stock_management: false, values: [], image_id }) as unknown as Variant;

/** Loja falsa: guarda o produto, simula a regra de posição (inserir desloca as outras) e registra as chamadas. */
class FakeStore implements ReplaceApi {
  product: Product;
  nextId = 1000;
  calls: string[] = [];
  failOn: string | null = null;
  constructor(images: ProductImage[], variants: Variant[]) {
    this.product = { id: 1, name: { pt: "Blusa" }, published: true, categories: [], attributes: [{ pt: "Cor" }], images, variants } as unknown as Product;
  }
  private sorted() {
    return [...this.product.images!].sort((a, b) => a.position! - b.position!);
  }
  private renumber(list: ProductImage[]) {
    list.forEach((i, n) => (i.position = n + 1));
    this.product.images = list;
  }
  async getProduct() {
    return structuredClone(this.product);
  }
  async create(_pid: number, input: { filename: string }) {
    this.calls.push(`create ${input.filename}`);
    if (this.failOn === "create") throw new Error("create falhou");
    const novo = img(this.nextId++, 999);
    this.renumber([...this.sorted(), novo]);
    return novo;
  }
  async remove(_pid: number, id: number) {
    this.calls.push(`remove ${id}`);
    if (this.failOn === "remove") throw new Error("remove falhou");
    this.renumber(this.sorted().filter((i) => i.id !== id));
    for (const v of this.product.variants!) if (v.image_id === id) v.image_id = null; // a loja desvincula
  }
  async setPosition(_pid: number, id: number, position: number) {
    this.calls.push(`pos ${id}->${position}`);
    const list = this.sorted().filter((i) => i.id !== id);
    list.splice(position - 1, 0, this.product.images!.find((i) => i.id === id)!);
    this.renumber(list);
    return this.product.images!.find((i) => i.id === id)!;
  }
  async setVariantImage(_pid: number, vid: number, imageId: number) {
    this.calls.push(`var ${vid}->${imageId}`);
    if (this.failOn === "variant") throw new Error("variante falhou");
    this.product.variants!.find((v) => v.id === vid)!.image_id = imageId;
  }
  order() {
    return this.sorted().map((i) => i.id);
  }
}

class FakeStorage implements BackupStorage {
  files = new Map<string, Buffer>();
  async put(p: string, b: Buffer) {
    this.files.set(p, b);
  }
  async get(p: string) {
    const f = this.files.get(p);
    if (!f) throw new Error("sem cópia");
    return f;
  }
}

const deps = (api: ReplaceApi, storage = new FakeStorage()): ReplaceDeps & { storage: FakeStorage } => ({
  db,
  api,
  storage,
  baixar: async () => JPEG,
  padronizar: async () => ({ bytes: Buffer.from([0xff, 0xd8, 0xff, 9, 9]), largura: 820, altura: 1024 }),
});

/** Espelha o produto e "mede" as fotos com as medidas dadas (por id). */
async function preparar(store: FakeStore, medidas: Record<number, Medida>) {
  await upsertProducts(db, storeId, [store.product]);
  await medirPendentes(db, { storeId, budgetMs: 10_000, medir: async (u) => medidas[Number(/\/(\d+)\./.exec(u)![1])]! });
}
const ruim: Medida = { width: 1024, height: 683, bytes: 300_000, format: "jpeg", error: null };
const boa: Medida = { width: 1024, height: 1024, bytes: 200_000, format: "jpeg", error: null };

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

describe("trocarImagem", () => {
  it("mantém a posição e leva a variante para a foto nova", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2), img(12, 3)], [variant(100, 11)]);
    await upsertProducts(db, storeId, [loja.product]);
    const r = await trocarImagem(deps(loja), { storeId, productId: 1, imageId: 11, bytes: JPEG, filename: "a.jpg" });
    expect(loja.order()).toEqual([10, r.novoId, 12]);
    expect(r.ordemOk).toBe(true);
    expect(loja.product.variants![0]!.image_id).toBe(r.novoId);
    const espelho = await pg.query<{ ids: string }>("SELECT jsonb_path_query_array(raw_json, '$.images[*].id')::text AS ids FROM products WHERE id = 1");
    expect(JSON.parse(espelho.rows[0]!.ids)).toEqual([10, r.novoId, 12]);
  });

  it("se a variante falhar, desfaz: a foto antiga continua e a nova some", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2)], [variant(100, 11), variant(101, 11)]);
    loja.failOn = "variant";
    await expect(trocarImagem(deps(loja), { storeId, productId: 1, imageId: 11, bytes: JPEG, filename: "a.jpg" })).rejects.toThrow("variante falhou");
    expect(loja.order()).toEqual([10, 11]);
    expect(loja.product.variants!.map((v) => v.image_id)).toEqual([11, 11]);
  });

  it("se o envio falhar, nada muda", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    loja.failOn = "create";
    await expect(trocarImagem(deps(loja), { storeId, productId: 1, imageId: 10, bytes: JPEG, filename: "a.jpg" })).rejects.toThrow();
    expect(loja.order()).toEqual([10]);
  });
});

describe("padronizar em lote", () => {
  it("troca só as fotos fora do padrão, guarda cópia, registra no histórico e termina", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2), img(12, 3)], [variant(100, 12)]);
    await preparar(loja, { 10: boa, 11: ruim, 12: ruim });
    const d = deps(loja);
    expect((await produtosPendentes(db, storeId)).map((p) => [p.id, p.imagens.length])).toEqual([[1, 2]]);

    const r = await padronizarPendentes(d, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r).toMatchObject({ fotos: 2, produtos: [1], falhas: [], restantes: false });
    expect(loja.order()).toHaveLength(3);
    expect(loja.order()[0]).toBe(10); // a que já estava no padrão ficou no lugar
    expect(loja.product.variants![0]!.image_id).toBe(loja.order()[2]);
    expect([...d.storage.files.keys()].sort()).toEqual([`originais/${storeId}/1/11.jpg`, `originais/${storeId}/1/12.jpg`]);
    expect((await produtosPendentes(db, storeId)).length).toBe(0);
    const log = await pg.query<{ acao: string; sucesso: boolean }>("SELECT acao, sucesso FROM audit_log ORDER BY id");
    expect(log.rows).toEqual([{ acao: "imagem.padronizar", sucesso: true }, { acao: "imagem.padronizar", sucesso: true }]);
  });

  it("ignora fotos pequenas, GIF e não medidas", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2), img(12, 3)], []);
    await preparar(loja, {
      10: { width: 500, height: 500, bytes: 50_000, format: "jpeg", error: null }, // só pequena
      11: { width: 1024, height: 683, bytes: 50_000, format: "gif", error: null },
      12: { width: null, height: null, bytes: null, format: null, error: "x" },
    });
    expect(await produtosPendentes(db, storeId)).toEqual([]);
  });

  it("falha em um produto não trava e o produto vai para a lista de falhas", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await preparar(loja, { 10: ruim });
    loja.failOn = "create";
    const d = deps(loja);
    const r = await padronizarPendentes(d, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r.fotos).toBe(0);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]).toMatchObject({ productId: 1, mensagem: "create falhou" });
    expect((await pg.query("SELECT 1 FROM image_backup")).rows).toHaveLength(0); // cópia sem troca é descartada
    const log = await pg.query<{ sucesso: boolean }>("SELECT sucesso FROM audit_log");
    expect(log.rows).toEqual([{ sucesso: false }]);
  });

  it("para no orçamento de tempo e continua depois", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2), img(12, 3)], []);
    await preparar(loja, { 10: ruim, 11: ruim, 12: ruim });
    let t = 0;
    const d = { ...deps(loja), now: () => (t += 100) };
    const r1 = await padronizarPendentes(d, { storeId, actor: "a@b.c", budgetMs: 250 });
    expect(r1.restantes).toBe(true);
    expect(r1.fotos).toBeGreaterThan(0);
    expect(r1.fotos).toBeLessThan(3);
    const r2 = await padronizarPendentes(deps(loja, d.storage), { storeId, actor: "a@b.c", budgetMs: 10_000 });
    expect(r1.fotos + r2.fotos).toBe(3);
    expect(r2.restantes).toBe(false);
  });

  it("limita a um produto quando pedido", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await preparar(loja, { 10: ruim });
    const r = await padronizarPendentes(deps(loja), { storeId, actor: "a@b.c", budgetMs: 10_000, produtoId: 999 });
    expect(r.fotos).toBe(0);
  });
});

describe("desfazer", () => {
  it("devolve a cópia no mesmo lugar e tira o produto do lote", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2)], [variant(100, 11)]);
    await preparar(loja, { 10: ruim, 11: ruim });
    const d = deps(loja);
    await padronizarPendentes(d, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    const padronizadas = loja.order();
    expect(padronizadas.every((id) => id >= 1000)).toBe(true);

    const r = await desfazerProduto(d, { storeId, actor: "a@b.c", productId: 1 });
    expect(r).toEqual({ restauradas: 2, ignoradas: 0, falhas: [] });
    expect(loja.order()).toHaveLength(2);
    expect(loja.order().some((id) => padronizadas.includes(id))).toBe(false);
    expect(loja.product.variants![0]!.image_id).toBe(loja.order()[1]);
    // restaurou: as fotos novas ainda não foram medidas e o produto não volta ao lote
    await medirPendentes(db, { storeId, budgetMs: 10_000, medir: async () => ruim });
    expect(await produtosPendentes(db, storeId)).toEqual([]);
    expect((await desfazerProduto(d, { storeId, actor: "a@b.c", productId: 1 })).restauradas).toBe(0);
  });

  it("ignora a cópia se a foto padronizada já foi removida na loja", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await preparar(loja, { 10: ruim });
    const d = deps(loja);
    await padronizarPendentes(d, { storeId, actor: "a@b.c", budgetMs: 10_000 });
    loja.product.images = [];
    expect(await desfazerProduto(d, { storeId, actor: "a@b.c", productId: 1 })).toEqual({ restauradas: 0, ignoradas: 1, falhas: [] });
  });
});
