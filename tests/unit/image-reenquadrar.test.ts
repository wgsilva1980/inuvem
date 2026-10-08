import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import sharp from "sharp";
import { loadMigrations, runMigrations } from "@/lib/db/migrate";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { carregarFonte, copiaDaFoto, fotosComOriginal, reenquadrarFoto } from "@/lib/images/reenquadrar";
import { desfazerProduto, type ReplaceApi, type ReplaceDeps } from "@/lib/images/replace";
import type { BackupStorage } from "@/lib/images/storage";
import type { Product, ProductImage, Variant } from "@/lib/nuvemshop/types";

let pg: PGlite;
let db: Db;
let storeId: string;

const img = (id: number, position: number): ProductImage => ({ id, product_id: 1, src: `https://x/${id}.jpg`, position }) as ProductImage;
const variant = (id: number, image_id: number | null): Variant => ({ id, product_id: 1, price: "10.00", stock_management: false, values: [], image_id }) as unknown as Variant;

/** Metade esquerda vermelha, direita azul. */
const metades = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: "#0000ff" } })
    .composite([{ input: { create: { width: 200, height: 400, channels: 3, background: "#ff0000" } }, left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();

class FakeStore implements ReplaceApi {
  product: Product;
  nextId = 1000;
  uploads: Buffer[] = [];
  constructor(images: ProductImage[], variants: Variant[]) {
    this.product = { id: 1, name: { pt: "Blusa" }, published: true, categories: [], attributes: [], images, variants } as unknown as Product;
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
  async create(_pid: number, input: { attachment?: string }) {
    this.uploads.push(Buffer.from(input.attachment!, "base64"));
    const novo = img(this.nextId++, 999);
    this.renumber([...this.sorted(), novo]);
    return novo;
  }
  async remove(_pid: number, id: number) {
    this.renumber(this.sorted().filter((i) => i.id !== id));
    for (const v of this.product.variants!) if (v.image_id === id) v.image_id = null;
  }
  async setPosition(_pid: number, id: number, position: number) {
    const list = this.sorted().filter((i) => i.id !== id);
    list.splice(position - 1, 0, this.product.images!.find((i) => i.id === id)!);
    this.renumber(list);
    return this.product.images!.find((i) => i.id === id)!;
  }
  async setVariantImage(_pid: number, vid: number, imageId: number) {
    this.product.variants!.find((v) => v.id === vid)!.image_id = imageId;
  }
  order() {
    return this.sorted().map((i) => i.id);
  }
}

class FakeStorage implements BackupStorage {
  files = new Map<string, Buffer>();
  failPut = false;
  async put(p: string, b: Buffer) {
    if (this.failPut) throw new Error("blob fora do ar");
    this.files.set(p, b);
  }
  async get(p: string) {
    const f = this.files.get(p);
    if (!f) throw new Error("sem cópia");
    return f;
  }
}

const mkDeps = (api: ReplaceApi, baixar: () => Promise<Buffer>, storage = new FakeStorage()): ReplaceDeps & { storage: FakeStorage } => ({ db, api, storage, baixar });

const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
const perto = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 16);

beforeEach(async () => {
  pg = new PGlite();
  db = { query: async (text, params) => (await pg.query(text, params as never)).rows as never };
  await runMigrations(
    { exec: async (s) => void (await pg.exec(s)), query: async (s, p) => (await pg.query(s, p)).rows as never },
    loadMigrations(join(process.cwd(), "db/migrations")),
  );
  storeId = (await pg.query<{ id: string }>("INSERT INTO stores (nuvemshop_store_id, access_token_encrypted) VALUES (1, 'x') RETURNING id")).rows[0]!.id;
});

describe("reenquadrarFoto", () => {
  it("foto sem cópia: guarda a atual como cópia, troca na loja mantendo posição e variação, e audita", async () => {
    const loja = new FakeStore([img(10, 1), img(11, 2), img(12, 3)], [variant(100, 11)]);
    await upsertProducts(db, storeId, [loja.product]);
    const original = await metades();
    const deps = mkDeps(loja, async () => original);

    const r = await reenquadrarFoto(deps, { storeId, actor: "a@b.c", productId: 1, imageId: 11, tipo: "peca", recorte: { x: 0, y: 0, w: 0.5 } });

    expect(r.origem).toBe("loja");
    expect(loja.order()).toEqual([10, r.novoId, 12]);
    expect(loja.product.variants![0]!.image_id).toBe(r.novoId);
    // o que foi enviado é o recorte da metade esquerda, em 1024×1024
    const enviado = loja.uploads[0]!;
    expect((await sharp(enviado).metadata()).width).toBe(1024);
    expect(perto(await pixel(enviado, 512, 512), [255, 0, 0])).toBe(true);
    // cópia guardada e ligada à foto nova
    expect(deps.storage.files.size).toBe(1);
    const copia = await copiaDaFoto(db, storeId, 1, r.novoId);
    expect(copia).not.toBeNull();
    expect(await fotosComOriginal(db, storeId, 1)).toEqual([String(r.novoId)]);
    const log = (await pg.query<{ acao: string; sucesso: boolean }>("SELECT acao, sucesso FROM audit_log WHERE acao = 'imagem.reenquadrar'")).rows;
    expect(log).toEqual([{ acao: "imagem.reenquadrar", sucesso: true }]);
  });

  it("segundo reenquadramento parte do original guardado (não da foto já recortada) e mantém uma só cópia", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await upsertProducts(db, storeId, [loja.product]);
    const original = await metades();
    let baixou = 0;
    const deps = mkDeps(loja, async () => (baixou++, original));

    const a = await reenquadrarFoto(deps, { storeId, actor: "a@b.c", productId: 1, imageId: 10, tipo: "peca", recorte: { x: 0, y: 0, w: 0.5 } });
    const b = await reenquadrarFoto(deps, { storeId, actor: "a@b.c", productId: 1, imageId: a.novoId, tipo: "peca", recorte: { x: 0.5, y: 0, w: 0.5 } });

    expect(b.origem).toBe("original");
    expect(baixou).toBe(1); // a segunda vez não baixou da loja
    expect(perto(await pixel(loja.uploads[1]!, 512, 512), [0, 0, 255])).toBe(true); // lado direito, que a primeira versão já não tinha
    expect(deps.storage.files.size).toBe(1);
    const linhas = (await pg.query<{ old_image_id: string; new_image_id: string }>("SELECT old_image_id::text, new_image_id::text FROM image_backup")).rows;
    expect(linhas).toEqual([{ old_image_id: "10", new_image_id: String(b.novoId) }]);
  });

  it("desfazer devolve o original sem recorte", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await upsertProducts(db, storeId, [loja.product]);
    const original = await metades();
    const deps = mkDeps(loja, async () => original);
    const a = await reenquadrarFoto(deps, { storeId, actor: "a@b.c", productId: 1, imageId: 10, tipo: "peca", recorte: { x: 0, y: 0, w: 0.5 } });
    const r = await desfazerProduto(deps, { storeId, actor: "a@b.c", productId: 1 });
    expect(r.restauradas).toBe(1);
    expect(loja.order()).toHaveLength(1);
    expect(loja.order()[0]).not.toBe(a.novoId);
    expect(loja.uploads.at(-1)!.equals(original)).toBe(true);
  });

  it("falha ao guardar a cópia: não troca nada na loja e não deixa cópia pendurada", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    await upsertProducts(db, storeId, [loja.product]);
    const storage = new FakeStorage();
    storage.failPut = true;
    const deps = mkDeps(loja, async () => metades(), storage);
    await expect(reenquadrarFoto(deps, { storeId, actor: "a@b.c", productId: 1, imageId: 10, tipo: "peca", recorte: { x: 0, y: 0, w: 0.5 } })).rejects.toThrow("blob fora do ar");
    expect(loja.uploads).toHaveLength(0);
    expect(loja.order()).toEqual([10]);
    expect((await pg.query("SELECT 1 FROM image_backup")).rows).toHaveLength(0);
    const log = (await pg.query<{ sucesso: boolean }>("SELECT sucesso FROM audit_log WHERE acao = 'imagem.reenquadrar'")).rows;
    expect(log).toEqual([{ sucesso: false }]);
  });

  it("foto que não está mais no produto dá erro claro", async () => {
    const loja = new FakeStore([img(10, 1)], []);
    const deps = mkDeps(loja, async () => metades());
    await expect(carregarFonte(deps, { storeId, productId: 1, imageId: 99 })).rejects.toThrow("não está mais no produto");
  });
});
