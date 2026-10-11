import { avisarIntegracao, obterConfigAlertas, resolverAlertaIntegracao, type ContextoAlerta } from "@/lib/alerts/service";
import { emailConfigurado } from "@/lib/digest/enviar";
import { obterConfigResumo } from "@/lib/digest/service";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import { parseScopes } from "@/lib/nuvemshop/scopes";
import type { Db } from "@/lib/sync/repo";
import { verificarCatalogo, verificarConexao, verificarEmail, verificarIa, verificarPedidos, verificarPermissoes, verificarWebhooks, type RespostaWebhooks, type StatusVigia, type Verificacao } from "./verificacoes";

/** Lista os webhooks da loja; nunca lança (um erro vira `ok: false`, com o status HTTP quando houver). */
export async function lerWebhooks(listar: () => Promise<Array<{ event?: string; url?: string }>>): Promise<RespostaWebhooks> {
  try {
    const lista = await listar();
    return { ok: true, webhooks: (Array.isArray(lista) ? lista : []).filter((w): w is { event: string; url: string } => typeof w.event === "string" && typeof w.url === "string") };
  } catch (err) {
    return err instanceof NuvemshopError ? { ok: false, status: err.status, mensagem: err.userMessage, webhooks: [] } : { ok: false, mensagem: "Não consegui falar com a Nuvemshop agora.", webhooks: [] };
  }
}

const TRES_DIAS = "now() - interval '3 days'";

/** Último erro de envio de e-mail dos últimos 3 dias (resumo, relatório mensal ou alerta), se houver. */
async function ultimoErroDeEmail(db: Db, storeId: string): Promise<string | null> {
  const [r] = await db.query<{ erro: string | null }>(
    `SELECT erro FROM (
       SELECT last_error AS erro, last_error_at AS quando FROM digest_settings WHERE store_id = $1::uuid AND last_error IS NOT NULL
       UNION ALL SELECT monthly_last_error, monthly_last_error_at FROM digest_settings WHERE store_id = $1::uuid AND monthly_last_error IS NOT NULL
       UNION ALL SELECT erro, created_at FROM alert_log WHERE store_id = $1::uuid AND erro IS NOT NULL AND enviados = 0 AND kind <> 'teste'
     ) t WHERE quando > ${TRES_DIAS} ORDER BY quando DESC LIMIT 1`,
    [storeId],
  );
  return r?.erro ? r.erro.slice(0, 200) : null;
}

export interface OpcoesVigia {
  storeId: string;
  /** Permissões concedidas à loja (campo `scope` da loja). */
  scope: string | null;
  appUrl: string;
  /** Lê os webhooks da loja (injetado para testar sem rede). */
  listarWebhooks: () => Promise<Array<{ event?: string; url?: string }>>;
  agora?: Date;
  env?: Record<string, string | undefined>;
  /** Manda e-mail quando um item passa a ter problema (padrão: sim). */
  alertar?: boolean;
  email?: Pick<ContextoAlerta, "config" | "fetchImpl">;
}

/**
 * Roda todas as verificações, guarda o resultado de cada uma e avisa por e-mail (se os alertas estiverem ligados) só quando um item PASSA para
 * “com problema”: não repete enquanto o problema continua, e volta a avisar se ele se recuperar e falhar de novo. Não altera nada na loja.
 */
export async function rodarVigia(db: Db, o: OpcoesVigia): Promise<Verificacao[]> {
  const agora = (o.agora ?? new Date()).getTime();
  const env = o.env ?? process.env;
  const [sync] = await db.query<{ status: string; quando: string }>("SELECT status, coalesce(finished_at, started_at)::text AS quando FROM sync_runs WHERE store_id = $1::uuid AND tipo <> 'webhook' ORDER BY started_at DESC LIMIT 1", [o.storeId]);
  const [ped] = await db.query<{ quando: string | null }>("SELECT orders_synced_at::text AS quando FROM store_settings WHERE store_id = $1::uuid", [o.storeId]);
  const [resumo, alertas] = await Promise.all([obterConfigResumo(db, o.storeId), obterConfigAlertas(db, o.storeId)]);
  const emUso = resumo.enabled || resumo.monthly || alertas.enabled;
  const api = await lerWebhooks(o.listarWebhooks);

  const verificacoes: Verificacao[] = [
    verificarConexao(api),
    verificarWebhooks(api, { appUrl: o.appUrl, precisaPedidoPago: alertas.enabled && alertas.onPaidOrder }),
    verificarCatalogo(sync ?? null, agora),
    verificarPedidos(ped?.quando ?? null, agora),
    verificarPermissoes(parseScopes(o.scope)),
    verificarEmail({ emUso, chaveConfigurada: emailConfigurado(env), ultimoErro: emUso ? await ultimoErroDeEmail(db, o.storeId) : null }),
    verificarIa(Boolean(env.ANTHROPIC_API_KEY?.trim())),
  ];

  const antes = new Map((await db.query<{ check_id: string; status: StatusVigia }>("SELECT check_id, status FROM integration_checks WHERE store_id = $1::uuid", [o.storeId])).map((r) => [r.check_id, r.status]));
  for (const v of verificacoes) {
    const anterior = antes.get(v.id);
    await db.query(
      `INSERT INTO integration_checks (store_id, check_id, status, detail, checked_at, since) VALUES ($1::uuid, $2, $3, $4, now(), now())
       ON CONFLICT (store_id, check_id) DO UPDATE SET
         since = CASE WHEN integration_checks.status = EXCLUDED.status THEN integration_checks.since ELSE now() END,
         status = EXCLUDED.status, detail = EXCLUDED.detail, checked_at = now()`,
      [o.storeId, v.id, v.status, [v.detalhe, v.acao].filter(Boolean).join(" → ")],
    );
    if (v.status === "erro" && anterior !== "erro" && o.alertar !== false) await avisarIntegracao(db, o.storeId, v, { appUrl: o.appUrl, ...o.email });
    if (v.status !== "erro" && anterior === "erro") await resolverAlertaIntegracao(db, o.storeId, v.id);
  }
  return verificacoes;
}

export interface EstadoSalvo {
  id: string;
  status: StatusVigia;
  detalhe: string;
  verificadoEm: string;
  desde: string;
}

/** O resultado da última verificação de cada item, do mais grave para o menos (para a tela). */
export async function estadoDoVigia(db: Db, storeId: string): Promise<EstadoSalvo[]> {
  const rows = await db.query<{ check_id: string; status: StatusVigia; detail: string; checked_at: string; since: string }>(
    `SELECT check_id, status, detail, checked_at::text, since::text FROM integration_checks WHERE store_id = $1::uuid
     ORDER BY CASE status WHEN 'erro' THEN 0 WHEN 'aviso' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END, check_id`,
    [storeId],
  );
  return rows.map((r) => ({ id: r.check_id, status: r.status, detalhe: r.detail, verificadoEm: r.checked_at, desde: r.since }));
}
