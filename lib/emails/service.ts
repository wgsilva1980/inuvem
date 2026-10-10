import { RevisaoConfigError } from "@/lib/images/review";
import type { Db } from "@/lib/sync/repo";
import { gravarReescrita, type SugestaoEmail, obterSugestao } from "./repo";
import type { Reescritor } from "./rewrite";

/** Reescreve um e-mail com a IA e guarda o resultado. Erro de configuração (chave da Anthropic) sobe; qualquer outro erro fica gravado no item. */
export async function reescreverEmail(
  db: Db,
  a: { storeId: string; actor: string; key: string; label: string; assunto: string; corpo: string; reescritor: Reescritor },
): Promise<SugestaoEmail> {
  let r;
  let erro: string | undefined;
  try {
    r = await a.reescritor({ rotulo: a.label, assunto: a.assunto, corpo: a.corpo });
  } catch (err) {
    if (err instanceof RevisaoConfigError) throw err;
    erro = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
  }
  await gravarReescrita(db, { storeId: a.storeId, key: a.key, label: a.label, assunto: a.assunto, corpo: a.corpo, r, erro });
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'email.reescrever', 'email', $3, $4::jsonb, $5)`,
    [a.storeId, a.actor, a.key, JSON.stringify({ modelo: a.label, avisos: r?.avisos ?? [], erro: erro ?? null }), !erro],
  );
  return (await obterSugestao(db, a.storeId, a.key)) as SugestaoEmail;
}
