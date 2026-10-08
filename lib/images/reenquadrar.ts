import { UPLOAD_TYPES, safeFilename, sniffImageType } from "@/lib/catalog/images";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { trocarImagem, type ReplaceDeps } from "./replace";
import { padronizarImagem, type Padronizada } from "./standardize";
import type { Recorte } from "./recorte";
import type { Tipo } from "./standard";

export interface FonteFoto {
  bytes: Buffer;
  /** "original": a cópia guardada antes da padronização (qualidade total). "loja": a foto como está na loja (no máximo 1024 px). */
  origem: "original" | "loja";
  /** Cópia (image_backup) que já existe para esta foto; null se ainda não há. */
  backupId: string | null;
  src: string;
}

/** Cópia vigente de uma foto da loja: a que foi guardada quando ela foi trocada por uma versão padronizada (ainda não desfeita). */
export async function copiaDaFoto(db: ReplaceDeps["db"], storeId: string, productId: number, imageId: number): Promise<{ id: string; blob_pathname: string } | null> {
  const rows = await db.query<{ id: string; blob_pathname: string }>(
    `SELECT id::text, blob_pathname FROM image_backup
     WHERE store_id = $1::uuid AND product_id = $2::bigint AND new_image_id = $3::bigint AND restored_at IS NULL ORDER BY id DESC LIMIT 1`,
    [storeId, productId, imageId],
  );
  return rows[0] ?? null;
}

/** Fotos do produto (ids) que têm cópia do original guardada: dá para reenquadrar a partir dela. */
export async function fotosComOriginal(db: ReplaceDeps["db"], storeId: string, productId: number): Promise<string[]> {
  return (
    await db.query<{ id: string }>(
      `SELECT DISTINCT new_image_id::text AS id FROM image_backup WHERE store_id = $1::uuid AND product_id = $2::bigint AND new_image_id IS NOT NULL AND restored_at IS NULL`,
      [storeId, productId],
    )
  ).map((r) => r.id);
}

/** Onde buscar a imagem a reenquadrar: a cópia do original, se houver; senão a foto atual da loja (endereço lido da própria loja, não do navegador). */
export async function carregarFonte(deps: ReplaceDeps, args: { storeId: string; productId: number; imageId: number }): Promise<FonteFoto> {
  const produto = await deps.api.getProduct(args.productId);
  const foto = (produto.images ?? []).find((i) => i.id === args.imageId);
  if (!foto) throw new Error("A foto não está mais no produto. Atualize a página.");
  const copia = await copiaDaFoto(deps.db, args.storeId, args.productId, args.imageId);
  if (copia) return { bytes: await deps.storage.get(copia.blob_pathname), origem: "original", backupId: copia.id, src: foto.src };
  return { bytes: await deps.baixar(foto.src), origem: "loja", backupId: null, src: foto.src };
}

const mensagemDe = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));

/**
 * Refaz o enquadramento de uma foto já cadastrada com o recorte escolhido e a troca na loja (mesma posição e variações).
 * Antes de trocar, guarda uma cópia da foto que sairá (se ainda não houver cópia do original): dá para desfazer em /imagens.
 */
export async function reenquadrarFoto(
  deps: ReplaceDeps,
  args: { storeId: string; actor: string; productId: number; imageId: number; tipo: Tipo | "auto"; recorte: Recorte },
): Promise<{ novoId: number; resultado: Padronizada; origem: FonteFoto["origem"]; ordemOk: boolean }> {
  const { db, storage } = deps;
  const { storeId, actor, productId, imageId } = args;
  let backupCriado: string | null = null;
  try {
    const fonte = await carregarFonte(deps, { storeId, productId, imageId });
    const resultado = await padronizarImagem(fonte.bytes, { tipo: args.tipo, enquadramento: "manual", recorte: args.recorte });
    let backupId = fonte.backupId;
    if (!backupId) {
      const tipoOriginal = sniffImageType(fonte.bytes) ?? "image/jpeg";
      const pathname = `originais/${storeId}/${productId}/${imageId}.${UPLOAD_TYPES[tipoOriginal] ?? "jpg"}`;
      await storage.put(pathname, fonte.bytes, tipoOriginal);
      const [criado] = await db.query<{ id: string }>(
        `INSERT INTO image_backup (store_id, product_id, old_image_id, blob_pathname, content_type, width, height, bytes)
         VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5, $6, $7, $8) RETURNING id::text`,
        [storeId, productId, imageId, pathname, tipoOriginal, resultado.original.largura, resultado.original.altura, fonte.bytes.length],
      );
      backupId = criado!.id;
      backupCriado = backupId;
    }
    const { novoId, ordemOk } = await trocarImagem(deps, { storeId, productId, imageId, bytes: resultado.bytes, filename: safeFilename(`foto-${imageId}`, "image/jpeg") });
    await db.query(`UPDATE image_backup SET new_image_id = $2::bigint WHERE id = $1::bigint`, [backupId, novoId]);
    await db.query(
      `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
       VALUES ($1::uuid, $2, 'imagem.reenquadrar', 'produto', $3, $4::jsonb, $5::jsonb, $6::jsonb, true)`,
      [
        storeId, actor, String(productId),
        JSON.stringify({ id: imageId }),
        JSON.stringify({ id: novoId, tipo: resultado.tipo, recorte: args.recorte, largura: resultado.largura, altura: resultado.altura, bytes: resultado.bytes.length, fonte: fonte.origem }),
        JSON.stringify({ status: "ok", ordemOk }),
      ],
    );
    return { novoId, resultado, origem: fonte.origem, ordemOk };
  } catch (err) {
    if (backupCriado) await db.query(`DELETE FROM image_backup WHERE id = $1::bigint AND new_image_id IS NULL`, [backupCriado]).catch(() => undefined);
    await db
      .query(
        `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, antes, depois, resultado_api, sucesso)
         VALUES ($1::uuid, $2, 'imagem.reenquadrar', 'produto', $3, $4::jsonb, '{}'::jsonb, $5::jsonb, false)`,
        [storeId, actor, String(productId), JSON.stringify({ id: imageId }), JSON.stringify({ mensagem: mensagemDe(err) })],
      )
      .catch(() => undefined);
    throw err;
  }
}
