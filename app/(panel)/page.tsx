import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { query, queryOne } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import type { SyncRun } from "@/lib/sync/engine";

const ERROS: Record<string, string> = {
  "codigo-ausente": "A Nuvemshop não enviou o código de autorização. Tente conectar novamente.",
  "estado-invalido": "A verificação de segurança da conexão falhou. Tente conectar novamente.",
  "falha-oauth": "Não foi possível concluir a conexão com a Nuvemshop. Confira as credenciais do app e tente de novo.",
};

function fmt(date: string | null): string {
  return date ? new Date(date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
}

export default async function Home({ searchParams }: { searchParams: Promise<{ conectado?: string; erro?: string }> }) {
  const sp = await searchParams;
  const store = await getActiveStore();

  let counts = { products: 0, variants: 0 };
  let last: SyncRun | null = null;
  if (store) {
    const [p, v] = await Promise.all([
      queryOne<{ n: string }>("SELECT count(*)::text AS n FROM products WHERE store_id = $1", [store.id]),
      queryOne<{ n: string }>("SELECT count(*)::text AS n FROM variants WHERE store_id = $1", [store.id]),
    ]);
    counts = { products: Number(p?.n ?? 0), variants: Number(v?.n ?? 0) };
    last = (await query<SyncRun>(
      "SELECT id, store_id, tipo, status, cursor, totais, erros, started_at, finished_at FROM sync_runs WHERE store_id = $1 AND tipo <> 'webhook' ORDER BY started_at DESC LIMIT 1",
      [store.id],
    ))[0] ?? null;
  }

  return (
    <main className="flex flex-col gap-4">
      {sp.conectado && (
        <p role="status" className="rounded-md border border-border bg-card p-3 text-sm text-success">
          Loja conectada com sucesso. Faça a primeira sincronização abaixo.
        </p>
      )}
      {sp.erro && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {ERROS[sp.erro] ?? "Ocorreu um erro."}
        </p>
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
        <h2 className="text-base font-semibold">Catálogo espelhado</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted">Produtos</dt>
            <dd className="text-2xl font-semibold">{counts.products}</dd>
          </div>
          <div>
            <dt className="text-muted">Variantes</dt>
            <dd className="text-2xl font-semibold">{counts.variants}</dd>
          </div>
        </dl>
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
    </main>
  );
}
