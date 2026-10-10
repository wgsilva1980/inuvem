import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/admin";
import { buttonClass } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { WebhookButton } from "@/components/webhook-button";
import Link from "next/link";
import { getCatalogStats, type CatalogStats } from "@/lib/dashboard/stats";
import { painelDoDia, type PainelDoDia } from "@/lib/dashboard/hoje";
import { PainelDoDiaCard } from "./painel-do-dia";
import { acaoLabel } from "@/lib/history/labels";
import { listHistory, type HistoryEntry } from "@/lib/history/query";
import { query, queryOne } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import type { SyncRun } from "@/lib/sync/engine";
import { Alert } from "@/components/ui/alert";
import { HistoryIcon } from "@/components/history-icon";
import { Badge } from "@/components/ui/badge";
import { parseScopes } from "@/lib/nuvemshop/scopes";

const ERROS: Record<string, string> = {
  "codigo-ausente": "A Nuvemshop não enviou o código de autorização. Tente conectar novamente.",
  "estado-invalido": "A verificação de segurança da conexão falhou. Tente conectar novamente.",
  "loja-diferente": "Essa autorização é de outra loja. O painel administra uma loja só; para reconectar, autorize a mesma loja já conectada.",
  "falha-oauth": "Não foi possível concluir a conexão com a Nuvemshop. Confira as credenciais do app e tente de novo.",
};

function fmt(date: string | null): string {
  return date ? new Date(date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
}

export default async function Home({ searchParams }: { searchParams: Promise<{ conectado?: string; erro?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();

  let stats: CatalogStats | null = null;
  let recent: HistoryEntry[] = [];
  let last: SyncRun | null = null;
  let painel: PainelDoDia | null = null;
  let lastWebhook: { event: string; received_at: string } | null = null;
  if (store) {
    [stats, recent] = await Promise.all([getCatalogStats({ query }, store.id), listHistory({ query }, store.id).then((h) => h.items.slice(0, 6))]);
    painel = await painelDoDia({ query }, store.id);
    lastWebhook = await queryOne<{ event: string; received_at: string }>(
      "SELECT event, received_at FROM webhook_events WHERE store_id = $1 ORDER BY received_at DESC LIMIT 1",
      [store.id],
    );
    last = (await query<SyncRun>(
      "SELECT id, store_id, tipo, status, cursor, totais, erros, started_at, finished_at FROM sync_runs WHERE store_id = $1 AND tipo <> 'webhook' ORDER BY started_at DESC LIMIT 1",
      [store.id],
    ))[0] ?? null;
  }

  const scopes = parseScopes(store?.scope);

  const attention = stats
    ? [
        { label: "sem imagem", value: stats.semImagem, param: "sem_imagem" },
        { label: "sem categoria", value: stats.semCategoria, param: "sem_categoria" },
        { label: "com variante sem SKU", value: stats.semSku, param: "sem_sku" },
        { label: "com variante sem estoque", value: stats.semEstoque, param: "sem_estoque" },
        { label: "sem descrição", value: stats.semDescricao, param: "sem_descricao" },
      ]
    : [];

  // O bloco de conexão fica aberto só quando precisa de ação: sem loja, nunca sincronizou ou a última sincronização falhou.
  const connectionNeedsAttention = !store || !last || last.status === "failed";
  const connectionSummary = !store
    ? "Nenhuma loja conectada"
    : `Loja ${store.nuvemshop_store_id} · ${last ? (last.status === "failed" ? "última sincronização falhou" : `sincronizada em ${fmt(last.finished_at ?? last.started_at)}`) : "ainda não sincronizada"}`;

  return (
    <main className="flex max-w-4xl flex-col gap-4">
      {sp.conectado && (
        <Alert tone="success">
          Loja conectada com sucesso. Faça a primeira sincronização abaixo.
        </Alert>
      )}
      {sp.erro && (
        <Alert tone="danger">
          {ERROS[sp.erro] ?? "Ocorreu um erro."}
        </Alert>
      )}

      {painel && stats && stats.produtos > 0 && <PainelDoDiaCard painel={painel} />}

      {stats && stats.produtos > 0 && (
        <>
          <Card>
            <h2 className="text-base font-semibold">Precisa de atenção</h2>
            {attention.every((a) => a.value === 0) ? (
              <p className="mt-2 text-sm text-success">Tudo em ordem: nenhum produto com pendências.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {attention.map((a) => (
                  <li key={a.param}>
                    {a.value > 0 ? (
                      <Link href={`/produtos?${a.param}=1`} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border-strong px-3 py-2 hover:bg-border/40">
                        <span>Produtos {a.label}</span>
                        <Badge tone="danger">{a.value}</Badge>
                      </Link>
                    ) : (
                      <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-muted">
                        <span>Produtos {a.label}</span>
                        <Badge tone="success">0</Badge>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Visão geral do catálogo</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {(
                [
                  ["Produtos", stats.produtos, "/produtos"],
                  ["Publicados", stats.publicados, "/produtos?status=publicados"],
                  ["Não publicados", stats.naoPublicados, "/produtos?status=rascunhos"],
                  ["Variantes", stats.variantes, null],
                  ["Categorias", stats.categorias, "/categorias"],
                ] as const
              ).map(([label, value, href]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-2xl font-semibold">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}

      {recent.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Atividade recente</h2>
            <Link href="/historico" className="text-sm text-muted underline hover:text-foreground">
              Ver histórico completo
            </Link>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center gap-3">
                <HistoryIcon acao={e.acao} falhou={!e.sucesso} />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span>
                    <span className={e.sucesso ? "" : "text-danger"}>{acaoLabel(e.acao, e.entidade)}</span>
                    {e.nome ? <span className="text-muted"> · {e.nome}</span> : null}
                    {e.sucesso ? null : <span className="text-danger"> (falhou)</span>}
                  </span>
                  <span className="text-xs text-muted">{fmt(e.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <details open={connectionNeedsAttention} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md">
            <span>
              <span className="block text-base font-semibold">Conexão com a loja</span>
              <span className="block text-sm text-muted">{connectionSummary}</span>
            </span>
            <span aria-hidden="true" className="text-muted transition group-open:rotate-180">
              ▾
            </span>
          </summary>

          <div className="mt-4 flex flex-col gap-6">
            <section>
              <h3 className="text-sm font-semibold">Loja Nuvemshop</h3>
              {store ? (
                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">ID da loja</dt>
                    <dd className="font-medium">{store.nuvemshop_store_id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Conectada em</dt>
                    <dd className="font-medium">{fmt(store.created_at)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted">Permissões{scopes.length > 0 ? ` (${scopes.length})` : ""}</dt>
                    <dd className="mt-1">
                      {scopes.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {scopes.map((sc) => (
                            <li key={sc}>
                              <Badge className="font-mono">{sc}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted">Nenhuma loja conectada ainda.</p>
              )}
              <div className="mt-4">
                <a href="/api/nuvemshop/connect" className={buttonClass(store ? "outline" : "primary")}>
                  {store ? "Reconectar loja" : "Conectar loja Nuvemshop"}
                </a>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold">Sincronização</h3>
              <p className="mt-1 text-sm text-muted">O catálogo daqui é uma cópia da loja; webhooks e o cron diário a mantêm em dia, e você pode forçar a qualquer momento.</p>
              <p className="mt-3 text-sm text-muted">
                Última sincronização: {last ? `${last.tipo} · ${last.status === "completed" ? "concluída" : last.status === "failed" ? "falhou" : "em andamento"} · ${fmt(last.finished_at ?? last.started_at)}` : "nunca"}
              </p>
              {last?.erros?.length ? (
                <p role="alert" className="mt-1 text-sm text-danger">
                  Último erro: {last.erros[last.erros.length - 1]?.message}
                </p>
              ) : null}
              <div className="mt-4">
                <SyncButton disabled={!store} />
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold">Webhooks</h3>
              <p className="mt-2 text-sm text-muted">
                A Nuvemshop avisa o painel quando um produto ou categoria muda, e o espelho é atualizado na hora. Registre uma vez (pode repetir sem problema).
              </p>
              <p className="mt-2 text-sm text-muted">
                Último evento recebido: {lastWebhook ? `${lastWebhook.event} · ${fmt(lastWebhook.received_at)}` : "nenhum ainda"}
              </p>
              <div className="mt-4">
                <WebhookButton disabled={!store} />
              </div>
            </section>
          </div>
        </details>
      </Card>
    </main>
  );
}
