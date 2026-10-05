import { UPLOAD_TYPES, safeFilename, sniffImageType } from "@/lib/catalog/images";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { ImageUpload } from "@/lib/nuvemshop/images";
import type { Product, ProductImage } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";
import { auditarProdutos, type ImagemAuditada } from "./audit";
import type { BackupStorage } from "./storage";
import { padronizarImagem } from "./standardize";

/** Acesso à Nuvemshop (injetado para testar sem rede). */
export interface ReplaceApi {
  getProduct(productId: number): Promise<Product>;
  create(productId: number, input: ImageUpload): Promise<ProductImage>;
  remove(productId: number, imageId: number): Promise<void>;
  setPosition(productId: number, imageId: number, position: number): Promise<ProductImage>;
  setVariantImage(productId: number, variantId: number, imageId: number): Promise<unknown>;
}

export interface ReplaceDeps {
  db: Db;
  api: ReplaceApi;
  storage: BackupStorage;
  /** Baixa uma foto da loja. */
  baixar: (url: string) => Promise<Buffer>;
  /** Padroniza a foto (1024×1024 ou 820×1024, JPEG). */
  padronizar?: (bytes: Buffer) => Promise<{ bytes: Buffer; largura: number; altura: number }>;
  now?: () => number;
}

export const baixarImagem = async (url: string): Promise<Buffer> => {
  if (!/^https:\/\//i.test(url)) throw new Error("endereço da foto não é https");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`a loja respondeu ${res.status} ao baixar a foto`);
  return Buffer.from(await res.arrayBuffer());
};

const padronizarPadrao: NonNullable<ReplaceDeps["padronizar"]> = async (bytes) => {
  const r = await padronizarImagem(bytes, {});
  return { bytes: r.bytes, largura: r.largura, altura: r.altura };
};

const ordenadas = (p: Product): ProductImage[] => [...(p.images ?? [])].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.id - b.id);

/** Leva as imagens do produto para a ordem `desejada` (ids). Devolve o produto como a loja ficou e se a ordem bateu. */
async function reordenar(api: ReplaceApi, productId: number, desejada: number[]): Promise<{ product: Product; ordemOk: boolean }> {
  for (let tentativa = 0; tentativa <= desejada.length + 1; tentativa++) {
    const product = await api.getProduct(productId);
    const atual = ordenadas(product);
    const i = desejada.findIndex((id, n) => atual[n]?.id !== id);
    if (i < 0 || i >= atual.length) return { product, ordemOk: true };
    await api.setPosition(productId, desejada[i]!, atual[i]!.position ?? i + 1); // assume a posição que a foto daquele lugar ocupa
  }
  return { product: await api.getProduct(productId), ordemOk: false };
}

/**
 * Troca uma foto por outra mantendo o lugar e as variações: envia a nova, aponta para ela as variações que usavam a antiga,
 * apaga a antiga e acerta a ordem. Se algo falhar antes de apagar, desfaz (a antiga continua na loja).
 */
export async function trocarImagem(
  deps: ReplaceDeps,
  args: { storeId: string; productId: number; imageId: number; bytes: Buffer; filename: string },
): Promise<{ novoId: number; ordemOk: boolean }> {
  const { api, db } = deps;
  const { storeId, productId, imageId } = args;
  const antes = await api.getProduct(productId);
  const ordem = ordenadas(antes).map((i) => i.id);
  if (!ordem.includes(imageId)) throw new Error("a foto não está mais no produto");
  const usando = (antes.variants ?? []).filter((v) => v.image_id === imageId).map((v) => v.id);

  const criada = await api.create(productId, { attachment: args.bytes.toString("base64"), filename: args.filename });
  const movidas: number[] = [];
  try {
    for (const vid of usando) {
      await api.setVariantImage(productId, vid, criada.id);
      movidas.push(vid);
    }
    await api.remove(productId, imageId);
  } catch (err) {
    for (const vid of movidas) await api.setVariantImage(productId, vid, imageId).catch(() => undefined);
    await api.remove(productId, criada.id).catch(() => undefined);
    throw err;
  }
  const { product, ordemOk } = await reordenar(api, productId, ordem.map((id) => (id === imageId ? criada.id : id)));
  await upsertProducts(db, storeId, [product]);
  return { novoId: criada.id, ordemOk };
}

/* ---------- o que padronizar ---------- */

/** Foto medida que foge do padrão de forma corrigível (só “pequena” não se resolve; GIF fica como está). */
export function imagemElegivel(i: ImagemAuditada): boolean {
  const m = i.medida;
  if (!m || m.error || m.format === "gif") return false;
  return i.problemas.some((p) => p === "proporcao" || p === "pesada" || p === "formato");
}

export interface ProdutoPendente {
  id: number;
  name: string;
  imagens: ImagemAuditada[];
}

/** Produtos com fotos a padronizar. Quem teve a padronização desfeita não volta para o lote. */
export async function produtosPendentes(db: Db, storeId: string): Promise<ProdutoPendente[]> {
  const desfeitos = new Set(
    (await db.query<{ product_id: string }>(`SELECT DISTINCT product_id::text FROM image_backup WHERE store_id = $1::uuid AND restored_at IS NOT NULL`, [storeId])).map((r) => r.product_id),
  );
  return (await auditarProdutos(db, storeId))
    .filter((p) => !desfeitos.has(p.id))
    .map((p) => ({ id: Number(p.id), name: p.name, imagens: p.imagens.filter(imagemElegivel) }))
    .filter((p) => p.imagens.length > 0);
}

async function registrar(db: Db, e: { storeId: string; actor: string; productId: number; acao: string; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean }) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [e.storeId, e.actor, e.acao, String(e.productId), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

/** Padroniza uma foto: guarda a cópia no Blob, gera a versão padrão e troca na loja. */
export async function padronizarFoto(deps: ReplaceDeps, args: { storeId: string; actor: string; productId: number; imagem: ImagemAuditada }): Promise<void> {
  const { db, storage } = deps;
  const { storeId, actor, productId, imagem } = args;
  const m = imagem.medida!;
  let backupId: string | null = null;
  try {
    const original = await deps.baixar(imagem.src);
    const tipo = sniffImageType(original) ?? "image/jpeg";
    const pathname = `originais/${storeId}/${productId}/${imagem.id}.${UPLOAD_TYPES[tipo] ?? "jpg"}`;
    await storage.put(pathname, original, tipo);
    const [criado] = await db.query<{ id: string }>(
      `INSERT INTO image_backup (store_id, product_id, old_image_id, blob_pathname, content_type, width, height, bytes)
       VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5, $6, $7, $8) RETURNING id::text`,
      [storeId, productId, imagem.id, pathname, tipo, m.width, m.height, original.length],
    );
    backupId = criado!.id;
    const nova = await (deps.padronizar ?? padronizarPadrao)(original);
    const { novoId, ordemOk } = await trocarImagem(deps, { storeId, productId, imageId: Number(imagem.id), bytes: nova.bytes, filename: safeFilename(`foto-${imagem.id}`, "image/jpeg") });
    await db.query(`UPDATE image_backup SET new_image_id = $2::bigint WHERE id = $1::bigint`, [backupId, novoId]);
    await registrar(db, {
      storeId, actor, productId, acao: "imagem.padronizar", sucesso: true,
      antes: { id: Number(imagem.id), largura: m.width, altura: m.height, bytes: m.bytes, formato: m.format },
      depois: { id: novoId, largura: nova.largura, altura: nova.altura, bytes: nova.bytes.length },
      resultado: { status: "ok", ordemOk },
    });
  } catch (err) {
    if (backupId) await db.query(`DELETE FROM image_backup WHERE id = $1::bigint AND new_image_id IS NULL`, [backupId]).catch(() => undefined);
    await registrar(db, { storeId, actor, productId, acao: "imagem.padronizar", sucesso: false, antes: { id: Number(imagem.id) }, depois: {}, resultado: { mensagem: mensagemDe(err) } });
    throw err;
  }
}

export interface PassoPadronizar {
  fotos: number;
  produtos: number[];
  falhas: Array<{ productId: number; nome: string; mensagem: string }>;
  restantes: boolean;
}

/**
 * Padroniza fotos pendentes até estourar o orçamento de tempo (uma por vez, para respeitar o limite da loja).
 * Retomável: o que falta é calculado do espelho. `ignorar` = produtos que já falharam nesta execução.
 */
export async function padronizarPendentes(
  deps: ReplaceDeps,
  args: { storeId: string; actor: string; budgetMs: number; produtoId?: number; ignorar?: number[] },
): Promise<PassoPadronizar> {
  const now = deps.now ?? Date.now;
  const inicio = now();
  const falhos = new Set(args.ignorar ?? []);
  const out: PassoPadronizar = { fotos: 0, produtos: [], falhas: [], restantes: false };
  while (true) {
    const fila = (await produtosPendentes(deps.db, args.storeId)).filter((p) => !falhos.has(p.id) && (args.produtoId === undefined || p.id === args.produtoId));
    const produto = fila[0];
    if (!produto) return out;
    if (now() - inicio >= args.budgetMs) return { ...out, restantes: true };
    try {
      await padronizarFoto(deps, { storeId: args.storeId, actor: args.actor, productId: produto.id, imagem: produto.imagens[0]! });
      out.fotos++;
      if (!out.produtos.includes(produto.id)) out.produtos.push(produto.id);
    } catch (err) {
      falhos.add(produto.id);
      out.falhas.push({ productId: produto.id, nome: produto.name, mensagem: mensagemDe(err) });
    }
  }
}

/** Desfaz a padronização do produto: a cópia guardada volta para a loja no lugar da foto padronizada. */
export async function desfazerProduto(deps: ReplaceDeps, args: { storeId: string; actor: string; productId: number }): Promise<{ restauradas: number; ignoradas: number; falhas: string[] }> {
  const { db, storage } = deps;
  const { storeId, actor, productId } = args;
  const copias = await db.query<{ id: string; new_image_id: string; blob_pathname: string }>(
    `SELECT id::text, new_image_id::text, blob_pathname FROM image_backup
     WHERE store_id = $1::uuid AND product_id = $2::bigint AND restored_at IS NULL AND new_image_id IS NOT NULL ORDER BY id`,
    [storeId, productId],
  );
  const r = { restauradas: 0, ignoradas: 0, falhas: [] as string[] };
  for (const c of copias) {
    try {
      const atual = await deps.api.getProduct(productId);
      if (!(atual.images ?? []).some((i) => i.id === Number(c.new_image_id))) {
        await db.query(`UPDATE image_backup SET restored_at = now() WHERE id = $1::bigint`, [c.id]); // a foto padronizada já não existe: nada a desfazer
        r.ignoradas++;
        continue;
      }
      const bytes = await storage.get(c.blob_pathname);
      const tipo = sniffImageType(bytes) ?? "image/jpeg";
      const { novoId } = await trocarImagem(deps, { storeId, productId, imageId: Number(c.new_image_id), bytes, filename: safeFilename(`foto-restaurada-${c.new_image_id}`, tipo) });
      await db.query(`UPDATE image_backup SET restored_at = now(), new_image_id = $2::bigint WHERE id = $1::bigint`, [c.id, novoId]);
      await registrar(db, { storeId, actor, productId, acao: "imagem.desfazer", sucesso: true, antes: { id: Number(c.new_image_id) }, depois: { id: novoId }, resultado: { status: "ok" } });
      r.restauradas++;
    } catch (err) {
      r.falhas.push(mensagemDe(err));
      await registrar(db, { storeId, actor, productId, acao: "imagem.desfazer", sucesso: false, antes: { id: Number(c.new_image_id) }, depois: {}, resultado: { mensagem: mensagemDe(err) } });
    }
  }
  return r;
}

export async function produtosComCopia(db: Db, storeId: string): Promise<Set<string>> {
  return new Set((await db.query<{ product_id: string }>(`SELECT DISTINCT product_id::text FROM image_backup WHERE store_id = $1::uuid AND restored_at IS NULL AND new_image_id IS NOT NULL`, [storeId])).map((r) => r.product_id));
}
