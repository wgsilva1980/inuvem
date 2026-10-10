import { painelDoDia } from "@/lib/dashboard/hoje";
import { normalizeEmail } from "@/lib/auth/admin-users";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import type { Db } from "@/lib/sync/repo";
import { configDoEmail, enviarEmail, type ConfigEmail } from "./enviar";
import { montarResumo, type ResumoMontado } from "./montar";

export interface ConfigResumo {
  enabled: boolean;
  recipients: string[];
  onlyIfAction: boolean;
  lastSentOn: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export const MAX_DESTINATARIOS = 5;

export async function obterConfigResumo(db: Db, storeId: string): Promise<ConfigResumo> {
  const [r] = await db.query<{ enabled: boolean; recipients: string[]; only_if_action: boolean; last_sent_on: string | null; last_error: string | null; last_error_at: string | null }>(
    "SELECT enabled, recipients, only_if_action, last_sent_on::text, last_error, last_error_at::text FROM digest_settings WHERE store_id = $1::uuid",
    [storeId],
  );
  return r ? { enabled: r.enabled, recipients: r.recipients, onlyIfAction: r.only_if_action, lastSentOn: r.last_sent_on, lastError: r.last_error, lastErrorAt: r.last_error_at } : { enabled: false, recipients: [], onlyIfAction: false, lastSentOn: null, lastError: null, lastErrorAt: null };
}

export class ResumoConfigError extends Error {}

/** Quais e-mails dessa lista são administradores do painel (os únicos que podem receber o resumo). */
export async function administradoresEntre(db: Db, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const rows = await db.query<{ email: string }>("SELECT email FROM admins WHERE email = ANY($1::text[])", [emails]);
  const ok = new Set(rows.map((r) => r.email));
  return emails.filter((e) => ok.has(e));
}

export async function salvarConfigResumo(db: Db, args: { storeId: string; actor: string; enabled: boolean; recipients: string[]; onlyIfAction: boolean }): Promise<ConfigResumo> {
  const normalizados = [...new Set(args.recipients.map((r) => normalizeEmail(r)).filter((e): e is string => e !== null))];
  if (normalizados.length !== new Set(args.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean)).size) throw new ResumoConfigError("Um dos e-mails não parece válido.");
  if (normalizados.length > MAX_DESTINATARIOS) throw new ResumoConfigError(`No máximo ${MAX_DESTINATARIOS} destinatários.`);
  const admins = await administradoresEntre(db, normalizados);
  const fora = normalizados.filter((e) => !admins.includes(e));
  if (fora.length > 0) throw new ResumoConfigError(`Só administradores do painel podem receber o resumo. Não são administradores: ${fora.join(", ")}. Libere o acesso em Usuários primeiro.`);
  if (args.enabled && admins.length === 0) throw new ResumoConfigError("Escolha ao menos um destinatário para ligar o resumo.");
  await db.query(
    `INSERT INTO digest_settings (store_id, enabled, recipients, only_if_action, updated_at, updated_by) VALUES ($1::uuid, $2, $3::text[], $4, now(), $5)
     ON CONFLICT (store_id) DO UPDATE SET enabled = $2, recipients = $3::text[], only_if_action = $4, updated_at = now(), updated_by = $5`,
    [args.storeId, args.enabled, admins, args.onlyIfAction, args.actor],
  );
  return obterConfigResumo(db, args.storeId);
}

const dataTexto = (agora: Date) => agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** O e-mail de hoje (sem enviar): serve para a prévia na tela e para o envio. */
export async function resumoDeHoje(db: Db, storeId: string, appUrl: string, agora: Date = new Date()): Promise<ResumoMontado> {
  return montarResumo(await painelDoDia(db, storeId, agora), { appUrl, dataTexto: dataTexto(agora) });
}

export type ResultadoEnvio = { enviado: true; destinatarios: number; resumo: Pick<ResumoMontado, "assunto" | "urgentes" | "atencao" | "total"> } | { enviado: false; motivo: string };

/**
 * Envia o resumo do dia. Automático (cron): só se estiver ligado, ainda não enviado hoje (Brasília) e, se a opção estiver marcada, só quando há algo
 * urgente ou de atenção. `manual` ignora essas condições (botão “Enviar agora”) e não conta como o envio do dia. Os destinatários são
 * conferidos contra os administradores na hora de enviar. Falhas ficam registradas na configuração e no Histórico.
 */
export async function enviarResumoDoDia(
  db: Db,
  args: { storeId: string; actor: string; appUrl: string; manual?: boolean; agora?: Date; config?: ConfigEmail; fetchImpl?: typeof fetch },
): Promise<ResultadoEnvio> {
  const agora = args.agora ?? new Date();
  const cfg = await obterConfigResumo(db, args.storeId);
  const hoje = hojeEmBrasilia(agora);
  if (!args.manual) {
    if (!cfg.enabled) return { enviado: false, motivo: "Resumo desligado." };
    if (cfg.lastSentOn === hoje) return { enviado: false, motivo: "Já enviado hoje." };
  }
  const destinatarios = await administradoresEntre(db, cfg.recipients);
  if (destinatarios.length === 0) return { enviado: false, motivo: "Nenhum destinatário administrador." };
  const resumo = await resumoDeHoje(db, args.storeId, args.appUrl, agora);
  if (!args.manual && cfg.onlyIfAction && resumo.urgentes + resumo.atencao === 0) return { enviado: false, motivo: "Nada urgente nem de atenção (opção “só enviar quando houver ação”)." };
  try {
    await enviarEmail({ para: destinatarios, assunto: args.manual ? `[teste] ${resumo.assunto}` : resumo.assunto, html: resumo.html, texto: resumo.texto }, args.config ?? configDoEmail(), args.fetchImpl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha ao enviar.";
    if (!args.manual) await db.query("UPDATE digest_settings SET last_error = $2, last_error_at = now() WHERE store_id = $1::uuid", [args.storeId, msg.slice(0, 500)]);
    await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'resumo.enviar', 'loja', $3::jsonb, false)`, [args.storeId, args.actor, JSON.stringify({ erro: msg.slice(0, 300), manual: Boolean(args.manual) })]);
    throw err;
  }
  if (!args.manual) await db.query("UPDATE digest_settings SET last_sent_on = $2::date, last_error = NULL, last_error_at = NULL WHERE store_id = $1::uuid", [args.storeId, hoje]);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'resumo.enviar', 'loja', $3::jsonb, true)`, [
    args.storeId,
    args.actor,
    JSON.stringify({ destinatarios: destinatarios.length, urgentes: resumo.urgentes, atencao: resumo.atencao, tarefas: resumo.total, manual: Boolean(args.manual) }),
  ]);
  return { enviado: true, destinatarios: destinatarios.length, resumo: { assunto: resumo.assunto, urgentes: resumo.urgentes, atencao: resumo.atencao, total: resumo.total } };
}
