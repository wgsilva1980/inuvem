import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/admin";
import { buttonClass } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { WebhookButton } from "@/components/webhook-button";
import Link from "next/link";
import { getCatalogStats, type CatalogStats } from "@/lib/dashboard/stats";
import { acaoLabel } from "@/lib/history/labels";
import { listHistory, type HistoryEntry } from "@/lib/history/query";
import { query, queryOne } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import type { SyncRun } from "@/lib/sync/engine";
import { Alert } from "@/components/ui/alert";

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
  let lastWebhook: { event: string; received_at: string } | null = null;
  if (store) {
    [stats, recent] = await Promise.all([getCatalogStats({ query }, store.id), listHistory({ query }, store.id).then((h) => h.items.slice(0, 6))]);
    lastWebhook = await queryOne<{ event: string; received_at: string }>(
      "SELECT event, received_at FROM webhook_events WHERE store_id = $1 ORDER BY received_at DESC LIMIT 1",
      [store.id],
    );
    last = (await query<SyncRun>(
      "SELECT id, store_id, tipo, status, cursor, totais, erros, started_at, finished_at FROM sync_runs WHERE store_id = $1 AND tipo <> 'webhook' ORDER BY started_at DESC LIMIT 1",
      [store.id],
    ))[0] ?? null;
  }

  return (
    <main className="flex flex-col gap-4">
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

      {stats && stats.produtos > 0 && (
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

          <h3 className="mt-5 text-sm font-semibold">Pontos de atenção</h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {(
              [
                ["sem imagem", stats.semImagem, "sem_imagem"],
                ["sem categoria", stats.semCategoria, "sem_categoria"],
                ["com variante sem SKU", stats.semSku, "sem_sku"],
                ["com variante sem estoque", stats.semEstoque, "sem_estoque"],
                ["sem descrição", stats.semDescricao, "sem_descricao"],
              ] as const
            ).map(([label, value, param]) => (
              <li key={param} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span>Produtos {label}</span>
                {value > 0 ? (
                  <Link href={`/produtos?${param}=1`} className="font-semibold text-danger underline">
                    {value}
                  </Link>
                ) : (
                  <span className="text-success">0</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
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
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className={e.sucesso ? "" : "text-danger"}>{acaoLabel(e.acao, e.entidade)}</span>
                  {e.nome ? <span className="text-muted"> · {e.nome}</span> : null}
                  {e.sucesso ? null : <span className="text-danger"> (falhou)</span>}
                </span>
                <span className="text-xs text-muted">{fmt(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="text-base font-semibold">Loja Nuvemshop</h2>
        {store ? (
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">ID da loja</dt>
              <dd className="font-medium">{store.nuvemshop_store_id}</dd>
            </div>
            <div>
              <dt className="text-muted">Permissões</dt>
              <dd className="font-medium">{store.scope || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Conectada em</dt>
              <dd className="font-medium">{fmt(store.created_at)}</dd>
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
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Sincronização</h2>
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
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Webhooks</h2>
        <p className="mt-2 text-sm text-muted">
          A Nuvemshop avisa o painel quando um produto ou categoria muda, e o espelho é atualizado na hora. Registre uma vez (pode repetir sem problema).
        </p>
        <p className="mt-2 text-sm text-muted">
          Último evento recebido: {lastWebhook ? `${lastWebhook.event} · ${fmt(lastWebhook.received_at)}` : "nenhum ainda"}
        </p>
        <div className="mt-4">
          <WebhookButton disabled={!store} />
        </div>
      </Card>
    </main>
  );
}
