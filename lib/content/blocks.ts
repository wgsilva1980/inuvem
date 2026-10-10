import { sanitizeDescription } from "@/lib/catalog/description";
import { BLOCO_HTML_MAX, BLOCO_NOME_MAX, marcaAbre } from "./aplicar";
import type { Db } from "@/lib/sync/repo";

export interface ContentBlock {
  id: string;
  name: string;
  html: string;
  updated_at: string;
}

/* ---------- validação ---------- */

export type EntradaBloco = { ok: true; name: string; html: string } | { ok: false; error: string };

export function validarBloco(nome: string, html: string): EntradaBloco {
  const name = nome.replace(/\s+/g, " ").trim();
  if (name.length < 2) return { ok: false, error: "Dê um nome ao bloco (pelo menos 2 letras)." };
  if (name.length > BLOCO_NOME_MAX) return { ok: false, error: `O nome pode ter no máximo ${BLOCO_NOME_MAX} caracteres.` };
  const limpo = sanitizeDescription(html).trim();
  if (limpo.replace(/<[^>]*>/g, "").trim() === "" && !/<img/i.test(limpo)) return { ok: false, error: "O bloco está vazio. Escreva o conteúdo." };
  if (limpo.length > BLOCO_HTML_MAX) return { ok: false, error: `O bloco é grande demais (máximo ${BLOCO_HTML_MAX} caracteres de HTML).` };
  return { ok: true, name, html: limpo };
}

/* ---------- banco ---------- */

export async function listarBlocos(db: Db, storeId: string): Promise<ContentBlock[]> {
  return db.query<ContentBlock>(
    `SELECT id::text AS id, name, html, updated_at::text AS updated_at FROM content_blocks WHERE store_id = $1::uuid ORDER BY lower(name)`,
    [storeId],
  );
}

export async function obterBloco(db: Db, storeId: string, id: string): Promise<ContentBlock | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db.query<ContentBlock>(
    `SELECT id::text AS id, name, html, updated_at::text AS updated_at FROM content_blocks WHERE store_id = $1::uuid AND id = $2::uuid`,
    [storeId, id],
  );
  return rows[0] ?? null;
}

export class BlocoError extends Error {}

export async function salvarBloco(db: Db, args: { storeId: string; actor: string; id?: string; name: string; html: string }): Promise<string> {
  const v = validarBloco(args.name, args.html);
  if (!v.ok) throw new BlocoError(v.error);
  try {
    if (args.id) {
      const rows = await db.query<{ id: string }>(
        `UPDATE content_blocks SET name = $3, html = $4, updated_at = now() WHERE store_id = $1::uuid AND id = $2::uuid RETURNING id::text AS id`,
        [args.storeId, args.id, v.name, v.html],
      );
      if (!rows[0]) throw new BlocoError("Bloco não encontrado.");
      return rows[0].id;
    }
    const rows = await db.query<{ id: string }>(
      `INSERT INTO content_blocks (store_id, name, html, created_by) VALUES ($1::uuid, $2, $3, $4) RETURNING id::text AS id`,
      [args.storeId, v.name, v.html, args.actor],
    );
    return (rows[0] as { id: string }).id;
  } catch (err) {
    if (err instanceof BlocoError) throw err;
    if (err instanceof Error && /content_blocks_name_uniq|duplicate key/i.test(err.message)) throw new BlocoError("Já existe um bloco com este nome.");
    throw err;
  }
}

export async function excluirBloco(db: Db, storeId: string, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(`DELETE FROM content_blocks WHERE store_id = $1::uuid AND id = $2::uuid RETURNING id::text AS id`, [storeId, id]);
  return rows.length > 0;
}

/** Quantos produtos do espelho têm cada bloco na descrição (pelas marcas do painel). */
export async function usoDosBlocos(db: Db, storeId: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of ids) {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM products WHERE store_id = $1::uuid AND position($2 in coalesce(description, '')) > 0`,
      [storeId, marcaAbre(id)],
    );
    out.set(id, Number(r[0]?.n ?? 0));
  }
  return out;
}
