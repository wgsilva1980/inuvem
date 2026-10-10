import { MODELO_REVISAO } from "@/lib/images/review";
import type { Db } from "@/lib/sync/repo";
import type { EmailReescrito } from "./rewrite";
import { EMAIL_CORPO_MAX, TIPOS_MANUAIS, ehTipoManual, type TipoManual } from "./tipos";
import { variaveisFaltando } from "./tokens";

export { EMAIL_CORPO_MAX, TIPOS_MANUAIS, ehTipoManual, type TipoManual };

export interface SugestaoEmail {
  key: string;
  label: string;
  original_subject: string;
  original_body: string;
  subject: string | null;
  body: string | null;
  warning: string | null;
  error: string | null;
  edited: boolean;
  generated_at: string;
  applied_at: string | null;
}

export async function listarSugestoes(db: Db, storeId: string): Promise<SugestaoEmail[]> {
  return db.query<SugestaoEmail>(
    `SELECT key, label, original_subject, original_body, subject, body, warning, error, edited, generated_at::text AS generated_at, applied_at::text AS applied_at
     FROM email_suggestion WHERE store_id = $1::uuid ORDER BY lower(label), key`,
    [storeId],
  );
}

export async function obterSugestao(db: Db, storeId: string, key: string): Promise<SugestaoEmail | null> {
  return (await listarSugestoes(db, storeId)).find((s) => s.key === key) ?? null;
}

/** Guarda a reescrita (ou o erro) de um e-mail; reescrever de novo substitui a anterior e zera "colado na loja". */
export async function gravarReescrita(
  db: Db,
  a: { storeId: string; key: string; label: string; assunto: string; corpo: string; r?: EmailReescrito; erro?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO email_suggestion (store_id, key, label, original_subject, original_body, subject, body, warning, error, edited, model, input_tokens, output_tokens, generated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, now())
     ON CONFLICT (store_id, key) DO UPDATE SET
       label = $3, original_subject = $4, original_body = $5, subject = $6, body = $7, warning = $8, error = $9, edited = false,
       model = $10, input_tokens = $11, output_tokens = $12, generated_at = now(), applied_at = NULL`,
    [a.storeId, a.key, a.label, a.assunto, a.corpo, a.r?.assunto ?? null, a.r?.corpo ?? null, a.r?.avisos.join("; ") || null, a.erro ?? null, MODELO_REVISAO, a.r?.entrada ?? null, a.r?.saida ?? null],
  );
}

/** Edição manual do texto novo. O aviso é recalculado: as variáveis do original precisam continuar no texto. */
export async function editarReescrita(db: Db, storeId: string, key: string, assunto: string, corpo: string): Promise<SugestaoEmail | null> {
  const atual = await obterSugestao(db, storeId, key);
  if (!atual || atual.error) return null;
  const faltam = [...variaveisFaltando(atual.original_subject, assunto), ...variaveisFaltando(atual.original_body, corpo)];
  const aviso = faltam.length > 0 ? `Faltam as variáveis ${[...new Set(faltam)].join(", ")}` : null;
  await db.query(
    `UPDATE email_suggestion SET subject = $3, body = $4, warning = $5, edited = true, applied_at = NULL WHERE store_id = $1::uuid AND key = $2`,
    [storeId, key, assunto, corpo, aviso],
  );
  return obterSugestao(db, storeId, key);
}

export async function marcarColado(db: Db, storeId: string, key: string, colado: boolean): Promise<boolean> {
  const rows = await db.query<{ key: string }>(
    `UPDATE email_suggestion SET applied_at = CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE store_id = $1::uuid AND key = $2 RETURNING key`,
    [storeId, key, colado],
  );
  return rows.length > 0;
}

export async function descartar(db: Db, storeId: string, key: string): Promise<boolean> {
  const rows = await db.query<{ key: string }>(`DELETE FROM email_suggestion WHERE store_id = $1::uuid AND key = $2 RETURNING key`, [storeId, key]);
  return rows.length > 0;
}
