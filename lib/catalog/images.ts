import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { ImageUpload } from "@/lib/nuvemshop/images";
import type { Product, ProductImage } from "@/lib/nuvemshop/types";
import { upsertProducts, type Db } from "@/lib/sync/repo";

/** Acesso à API da Nuvemshop (injetado para testar sem rede). */
export interface ImageApi {
  getProduct(productId: number): Promise<Product>;
  create(productId: number, input: ImageUpload): Promise<ProductImage>;
  remove(productId: number, imageId: number): Promise<void>;
  setPosition(productId: number, imageId: number, position: number): Promise<ProductImage>;
}

/** Limite do arquivo enviado ao painel: o corpo de uma requisição na Vercel é de no máximo 4,5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Tipo real da imagem pelos primeiros bytes (o tipo declarado pelo navegador não é confiável). null se não for um dos formatos aceitos. */
export function sniffImageType(bytes: Uint8Array): keyof typeof UPLOAD_TYPES | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || starts([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Confere tipo e tamanho do arquivo enviado; devolve a mensagem de erro ou null. */
export function validateImageUpload(file: { type: string; size: number }): string | null {
  if (!(file.type in UPLOAD_TYPES)) return "Formato não aceito. Use JPEG, PNG, WEBP ou GIF.";
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > MAX_UPLOAD_BYTES) return "A imagem passa de 4 MB. Reduza o tamanho e tente de novo.";
  return null;
}

/** Nome de arquivo seguro: sem caminho, só letras/números/._-, e a extensão do tipo real do arquivo. */
export function safeFilename(name: string, contentType: string): string {
  const ext = UPLOAD_TYPES[contentType] ?? "jpg";
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "imagem"}.${ext}`;
}

export interface ImageRow {
  id: string;
  src: string;
  position: number | null;
  alt: string;
}

/** Imagens do produto no espelho, na ordem de exibição. */
export async function getProductImages(db: Db, storeId: string, productId: number): Promise<ImageRow[]> {
  return db.query<ImageRow>(
    `SELECT (i->>'id') AS id, (i->>'src') AS src, nullif(i->>'position', '')::int AS position,
            coalesce(i->'alt'->>'pt', '') AS alt
     FROM products p, jsonb_array_elements(coalesce(p.raw_json->'images', '[]'::jsonb)) WITH ORDINALITY AS t(i, n)
     WHERE p.store_id = $1::uuid AND p.id = $2::bigint
     ORDER BY nullif(i->>'position', '')::int NULLS LAST, t.n`,
    [storeId, productId],
  );
}

export class ProductMissingError extends Error {
  constructor() {
    super("Produto não encontrado no espelho. Sincronize o catálogo e tente de novo.");
  }
}

type Action = "adicionar" | "enviar" | "remover" | "reordenar";

async function audit(
  db: Db,
  e: { storeId: string; actor: string; productId: number; acao: Action; antes: unknown; depois: unknown; resultado: unknown; sucesso: boolean },
) {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
     VALUES ($1::uuid, $2, $3, 'produto', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
    [e.storeId, e.actor, `imagem.${e.acao}`, String(e.productId), JSON.stringify(e.antes), JSON.stringify(e.depois), JSON.stringify(e.resultado), e.sucesso],
  );
}

/**
 * Executa uma operação de imagem na Nuvemshop e, em seguida, rebusca o produto e regrava o espelho: assim a tela
 * mostra a ordem e as imagens exatamente como a loja ficou (a regra de reposicionamento é decidida por ela).
 */
async function run(
  db: Db,
  api: ImageApi,
  args: { storeId: string; actor: string; productId: number; acao: Action; antes: unknown; depois: unknown },
  op: () => Promise<unknown>,
): Promise<void> {
  const { storeId, actor, productId, acao, antes, depois } = args;
  try {
    await op();
    await upsertProducts(db, storeId, [await api.getProduct(productId)]);
    await audit(db, { storeId, actor, productId, acao, antes, depois, resultado: { status: "ok" }, sucesso: true });
  } catch (err) {
    const resultado =
      err instanceof NuvemshopError ? { status: err.status, mensagem: err.apiMessage ?? err.message } : { mensagem: err instanceof Error ? err.message : String(err) };
    await audit(db, { storeId, actor, productId, acao, antes, depois, resultado, sucesso: false });
    throw err;
  }
}

type Base = { storeId: string; actor: string; productId: number };

async function current(db: Db, base: Base): Promise<ImageRow[]> {
  const images = await getProductImages(db, base.storeId, base.productId);
  const exists = await db.query("SELECT 1 FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [base.storeId, base.productId]);
  if (exists.length === 0) throw new ProductMissingError();
  return images;
}

/** Envia o arquivo (já validado) à Nuvemshop em base64. O conteúdo não vai para o histórico, só o nome e o tamanho. */
export async function uploadImage(db: Db, api: ImageApi, base: Base & { filename: string; bytes: Buffer; detalhes?: Record<string, unknown> }): Promise<void> {
  const images = await current(db, base);
  await run(db, api, { ...base, acao: "enviar", antes: { total: images.length }, depois: { filename: base.filename, bytes: base.bytes.length, ...(base.detalhes ?? {}) } }, () =>
    api.create(base.productId, { attachment: base.bytes.toString("base64"), filename: base.filename }),
  );
}

export async function removeImage(db: Db, api: ImageApi, base: Base & { imageId: number }): Promise<void> {
  const images = await current(db, base);
  const target = images.find((i) => Number(i.id) === base.imageId);
  await run(db, api, { ...base, acao: "remover", antes: { id: base.imageId, src: target?.src ?? null }, depois: { total: images.length - 1 } }, () =>
    api.remove(base.productId, base.imageId),
  );
}

/** Move a imagem para o índice `toIndex` (0 = principal). Sem efeito se já estiver lá. */
export async function moveImageTo(db: Db, api: ImageApi, base: Base & { imageId: number; toIndex: number }): Promise<boolean> {
  const images = await current(db, base);
  const from = images.findIndex((i) => Number(i.id) === base.imageId);
  const to = base.toIndex;
  if (from < 0 || to < 0 || to >= images.length || from === to) return false;
  const newPosition = images[to]!.position ?? to + 1; // assume a posição que a imagem daquele lugar ocupa hoje
  await run(db, api, { ...base, acao: "reordenar", antes: { id: base.imageId, posicao: images[from]!.position ?? from + 1 }, depois: { id: base.imageId, posicao: newPosition } }, () =>
    api.setPosition(base.productId, base.imageId, newPosition),
  );
  return true;
}

/** Move a imagem uma posição para cima (-1) ou para baixo (+1). Sem efeito nas pontas. */
export async function moveImage(db: Db, api: ImageApi, base: Base & { imageId: number; direction: -1 | 1 }): Promise<boolean> {
  const images = await current(db, base);
  const from = images.findIndex((i) => Number(i.id) === base.imageId);
  if (from < 0) return false;
  return moveImageTo(db, api, { storeId: base.storeId, actor: base.actor, productId: base.productId, imageId: base.imageId, toIndex: from + base.direction });
}
