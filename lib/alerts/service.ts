import { normalizeEmail } from "@/lib/auth/admin-users";
import { configDoEmail, enviarEmail, type ConfigEmail } from "@/lib/digest/enviar";
import { MAX_DESTINATARIOS, administradoresEntre } from "@/lib/digest/service";
import { pt } from "@/lib/nuvemshop/types";
import type { Product } from "@/lib/nuvemshop/types";
import type { Order } from "@/lib/nuvemshop/orders";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import type { Db } from "@/lib/sync/repo";
import { todasSemEstoque } from "@/lib/automations/out-of-stock";
import { alertaEsgotado, alertaIntegracao, alertaPedidoPago, alertaSyncFalhou, alertaTeste, montarEmailAlerta, type AlertaMontado } from "./montar";

export type TipoAlerta = "pedido_pago" | "esgotado" | "sync_falhou" | "integracao";

export interface ConfigAlertas {
  enabled: boolean;
  recipients: string[];
  onPaidOrder: boolean;
  onOutOfStock: boolean;
  onSyncFailure: boolean;
  onIntegrations: boolean;
}

/** Quantos alertas por hora, no máximo: uma importação que zere dezenas de produtos não pode lotar a caixa de entrada. */
export const MAX_POR_HORA = 10;

export class AlertaConfigError extends Error {}

export async function obterConfigAlertas(db: Db, storeId: string): Promise<ConfigAlertas> {
  const [r] = await db.query<{ enabled: boolean; recipients: string[]; on_paid_order: boolean; on_out_of_stock: boolean; on_sync_failure: boolean; on_integrations: boolean }>(
    "SELECT enabled, recipients, on_paid_order, on_out_of_stock, on_sync_failure, on_integrations FROM alert_settings WHERE store_id = $1::uuid",
    [storeId],
  );
  return r
    ? { enabled: r.enabled, recipients: r.recipients, onPaidOrder: r.on_paid_order, onOutOfStock: r.on_out_of_stock, onSyncFailure: r.on_sync_failure, onIntegrations: r.on_integrations }
    : { enabled: false, recipients: [], onPaidOrder: true, onOutOfStock: true, onSyncFailure: true, onIntegrations: true };
}

export async function salvarConfigAlertas(db: Db, args: { storeId: string; actor: string } & Omit<ConfigAlertas, "onIntegrations"> & { onIntegrations?: boolean }): Promise<ConfigAlertas> {
  const onIntegrations = args.onIntegrations ?? true;
  const brutos = [...new Set(args.recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  const normalizados = [...new Set(args.recipients.map((r) => normalizeEmail(r)).filter((e): e is string => e !== null))];
  if (normalizados.length !== brutos.length) throw new AlertaConfigError("Um dos e-mails não parece válido.");
  if (normalizados.length > MAX_DESTINATARIOS) throw new AlertaConfigError(`No máximo ${MAX_DESTINATARIOS} destinatários.`);
  const admins = await administradoresEntre(db, normalizados);
  const fora = normalizados.filter((e) => !admins.includes(e));
  if (fora.length > 0) throw new AlertaConfigError(`Só administradores do painel podem receber alertas. Não são administradores: ${fora.join(", ")}. Libere o acesso em Usuários primeiro.`);
  if (args.enabled && admins.length === 0) throw new AlertaConfigError("Escolha ao menos um destinatário para ligar os alertas.");
  if (args.enabled && !args.onPaidOrder && !args.onOutOfStock && !args.onSyncFailure && !onIntegrations) throw new AlertaConfigError("Marque ao menos um tipo de alerta.");
  await db.query(
    `INSERT INTO alert_settings (store_id, enabled, recipients, on_paid_order, on_out_of_stock, on_sync_failure, on_integrations, updated_at, updated_by)
     VALUES ($1::uuid, $2, $3::text[], $4, $5, $6, $8, now(), $7)
     ON CONFLICT (store_id) DO UPDATE SET enabled = $2, recipients = $3::text[], on_paid_order = $4, on_out_of_stock = $5, on_sync_failure = $6, on_integrations = $8, updated_at = now(), updated_by = $7`,
    [args.storeId, args.enabled, admins, args.onPaidOrder, args.onOutOfStock, args.onSyncFailure, args.actor, onIntegrations],
  );
  return obterConfigAlertas(db, args.storeId);
}

export type ResultadoAlerta = "enviado" | "falhou" | "desligado" | "sem_destinatario" | "repetido" | "limite";

const ligadoPara = (c: ConfigAlertas, kind: TipoAlerta) => c.enabled && (kind === "pedido_pago" ? c.onPaidOrder : kind === "esgotado" ? c.onOutOfStock : kind === "integracao" ? c.onIntegrations : c.onSyncFailure);

export interface OpcoesEnvio {
  config?: ConfigEmail;
  fetchImpl?: typeof fetch;
}

/**
 * Manda um alerta, no máximo uma vez por fato (`chave`). Nunca lança: um alerta que falha não pode derrubar o webhook nem a sincronização;
 * o motivo fica em alert_log. O registro é feito ANTES do envio, então reenvios do webhook não duplicam o e-mail.
 */
export async function dispararAlerta(db: Db, args: { storeId: string; kind: TipoAlerta; chave: string; montar: () => AlertaMontado } & OpcoesEnvio): Promise<ResultadoAlerta> {
  try {
    const cfg = await obterConfigAlertas(db, args.storeId);
    if (!ligadoPara(cfg, args.kind)) return "desligado";
    const destinatarios = await administradoresEntre(db, cfg.recipients);
    if (destinatarios.length === 0) return "sem_destinatario";
    const alerta = args.montar();
    const [novo] = await db.query<{ id: string }>(
      `INSERT INTO alert_log (store_id, kind, chave, titulo) VALUES ($1::uuid, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id::text AS id`,
      [args.storeId, args.kind, args.chave, alerta.assunto.slice(0, 200)],
    );
    if (!novo) return "repetido";
    const [cont] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM alert_log WHERE store_id = $1::uuid AND kind <> 'teste' AND NOT suprimido AND created_at > now() - interval '1 hour'", [args.storeId]);
    if ((cont?.n ?? 0) > MAX_POR_HORA) {
      await db.query("UPDATE alert_log SET suprimido = true WHERE id = $1::bigint", [novo.id]);
      return "limite";
    }
    try {
      const envio = await enviarEmail({ para: destinatarios, ...montarEmailAlerta(alerta) }, args.config ?? configDoEmail(), args.fetchImpl);
      await db.query("UPDATE alert_log SET enviados = $2, erro = $3 WHERE id = $1::bigint", [novo.id, envio.enviados.length, envio.falhas[0]?.erro.slice(0, 500) ?? null]);
      return "enviado";
    } catch (err) {
      await db.query("UPDATE alert_log SET erro = $2 WHERE id = $1::bigint", [novo.id, (err instanceof Error ? err.message : "Falha ao enviar.").slice(0, 500)]);
      return "falhou";
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "alertas.disparar_falhou", kind: args.kind, message: err instanceof Error ? err.message : String(err) }));
    return "falhou";
  }
}

/** Teste: manda um e-mail de exemplo aos destinatários salvos, mesmo com os alertas desligados. Lança se não puder enviar. */
export async function enviarAlertaTeste(db: Db, args: { storeId: string; appUrl: string } & OpcoesEnvio): Promise<{ enviados: number; aviso?: string }> {
  const cfg = await obterConfigAlertas(db, args.storeId);
  const destinatarios = await administradoresEntre(db, cfg.recipients);
  if (destinatarios.length === 0) throw new AlertaConfigError("Salve ao menos um destinatário antes de enviar o teste.");
  const alerta = alertaTeste(args.appUrl);
  const [novo] = await db.query<{ id: string }>(`INSERT INTO alert_log (store_id, kind, chave, titulo) VALUES ($1::uuid, 'teste', $2, $3) RETURNING id::text AS id`, [args.storeId, String(Date.now()), alerta.assunto]);
  try {
    const envio = await enviarEmail({ para: destinatarios, ...montarEmailAlerta(alerta) }, args.config ?? configDoEmail(), args.fetchImpl);
    const aviso = envio.falhas.length > 0 ? `Não foi possível enviar para ${envio.falhas.length} de ${destinatarios.length}: ${envio.falhas[0]!.erro}`.slice(0, 500) : undefined;
    await db.query("UPDATE alert_log SET enviados = $2, erro = $3 WHERE id = $1::bigint", [novo!.id, envio.enviados.length, aviso ?? null]);
    return { enviados: envio.enviados.length, ...(aviso ? { aviso } : {}) };
  } catch (err) {
    await db.query("UPDATE alert_log SET erro = $2 WHERE id = $1::bigint", [novo!.id, (err instanceof Error ? err.message : "Falha ao enviar.").slice(0, 500)]);
    throw err;
  }
}

/* ---------- gatilhos ---------- */

export interface ContextoAlerta extends OpcoesEnvio {
  appUrl: string;
}

const numero = (v: unknown): number | null => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export const avisarPedidoPago = (db: Db, storeId: string, order: Order, ctx: ContextoAlerta) =>
  dispararAlerta(db, {
    storeId,
    kind: "pedido_pago",
    chave: String(order.id),
    config: ctx.config,
    fetchImpl: ctx.fetchImpl,
    montar: () =>
      alertaPedidoPago({
        numero: order.number ?? order.id,
        total: numero(order.total),
        itens: (order.products ?? []).map((p) => ({ nome: pt(p.name as never) || "Produto", quantidade: numero(p.quantity) ?? 1 })),
        appUrl: ctx.appUrl,
      }),
  });

/**
 * Produto publicado que ficou sem estoque em todas as variações: avisa uma vez. Quando o estoque volta, o fato é “resolvido” e um novo
 * esgotamento avisa de novo. Produto não publicado não avisa (rascunho sem estoque não é novidade).
 */
export async function avaliarEsgotado(db: Db, storeId: string, produto: Product, ctx: ContextoAlerta & { regraDespublicaLigada?: boolean }): Promise<ResultadoAlerta | "resolvido" | "nao_se_aplica"> {
  if (!todasSemEstoque(produto)) {
    await db.query("UPDATE alert_log SET resolvido_em = now() WHERE store_id = $1::uuid AND kind = 'esgotado' AND chave = $2 AND resolvido_em IS NULL", [storeId, String(produto.id)]).catch(() => undefined);
    return "resolvido";
  }
  if (produto.published !== true) return "nao_se_aplica";
  return dispararAlerta(db, {
    storeId,
    kind: "esgotado",
    chave: String(produto.id),
    config: ctx.config,
    fetchImpl: ctx.fetchImpl,
    montar: () => alertaEsgotado({ id: produto.id, nome: pt(produto.name) || `Produto ${produto.id}`, despublicado: ctx.regraDespublicaLigada === true, appUrl: ctx.appUrl }),
  });
}

/** Uma falha de sincronização por dia no máximo (o cron roda uma vez por dia, mas o botão “sincronizar” pode falhar várias vezes). */
export const avisarSyncFalhou = (db: Db, storeId: string, mensagem: string, ctx: ContextoAlerta, agora: Date = new Date()) =>
  dispararAlerta(db, { storeId, kind: "sync_falhou", chave: hojeEmBrasilia(agora), config: ctx.config, fetchImpl: ctx.fetchImpl, montar: () => alertaSyncFalhou({ mensagem, appUrl: ctx.appUrl }) });

/** Uma integração que passou a ter problema: avisa uma vez, até ela se recuperar (`resolverAlertaIntegracao`). */
export const avisarIntegracao = (db: Db, storeId: string, v: { id: string; rotulo: string; detalhe: string; acao?: string }, ctx: ContextoAlerta) =>
  dispararAlerta(db, { storeId, kind: "integracao", chave: v.id, config: ctx.config, fetchImpl: ctx.fetchImpl, montar: () => alertaIntegracao({ rotulo: v.rotulo, detalhe: v.detalhe, acao: v.acao, appUrl: ctx.appUrl }) });

export const resolverAlertaIntegracao = (db: Db, storeId: string, id: string) =>
  db.query("UPDATE alert_log SET resolvido_em = now() WHERE store_id = $1::uuid AND kind = 'integracao' AND chave = $2 AND resolvido_em IS NULL", [storeId, id]);

export interface LinhaAlerta {
  id: string;
  kind: string;
  titulo: string;
  created_at: string;
  enviados: number;
  erro: string | null;
  suprimido: boolean;
}

export const alertasRecentes = (db: Db, storeId: string, limite = 20) =>
  db.query<LinhaAlerta>("SELECT id::text AS id, kind, titulo, created_at::text AS created_at, enviados, erro, suprimido FROM alert_log WHERE store_id = $1::uuid ORDER BY id DESC LIMIT $2", [storeId, limite]);
