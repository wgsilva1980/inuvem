import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { acaoLabel, TIPO_LABEL } from "@/lib/history/labels";
import { HISTORY_TYPES, listHistory } from "@/lib/history/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  tipo: z.enum(HISTORY_TYPES as [string, ...string[]]).optional().catch(undefined),
  falhas: z.literal("1").optional().catch(undefined),
  produto: z.coerce.number().int().positive().optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).optional().catch(undefined),
});

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v, null, 2));

export default async function HistoricoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const result = await listHistory({ query }, store.id, { tipo: sp.tipo as never, falhas: sp.falhas === "1", produto: sp.produto, page: sp.pagina });

  const href = (page: number) => {
    const p = new URLSearchParams();
    if (sp.tipo) p.set("tipo", sp.tipo);
    if (sp.falhas) p.set("falhas", "1");
    if (sp.produto) p.set("produto", String(sp.produto));
    if (page > 1) p.set("pagina", String(page));
    const qs = p.toString();
    return qs ? `/historico?${qs}` : "/historico";
  };
  const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary";

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Histórico de alterações</h1>
        <p className="text-sm text-muted">{result.total} {result.total === 1 ? "registro" : "registros"}</p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">O que</span>
            <select name="tipo" defaultValue={sp.tipo ?? ""} className={field}>
              <option value="">Tudo</option>
              {HISTORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {sp.produto ? <input type="hidden" name="produto" value={sp.produto} /> : null}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="falhas" value="1" defaultChecked={sp.falhas === "1"} />
            <span>Só o que falhou</span>
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Filtrar
          </button>
          <Link href="/historico" className={buttonClass("outline")}>
            Limpar
          </Link>
        </form>
        {sp.produto && (
          <p className="mt-3 text-sm text-muted">
            Mostrando só o produto{" "}
            <Link href={`/produtos/${sp.produto}`} className="underline">
              #{sp.produto}
            </Link>{" "}
            (e suas variantes).
          </p>
        )}
      </Card>

      <Card className="p-0 sm:p-0">
        {result.items.length === 0 ? (
          <p className="p-6 text-sm text-muted">Nenhuma alteração registrada com esses filtros.</p>
        ) : (
          <ul className="divide-y divide-border">
            {result.items.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className={`font-medium ${e.sucesso ? "" : "text-danger"}`}>{acaoLabel(e.acao, e.entidade)}</span>
                    {e.sucesso ? null : <span className="text-danger"> · falhou</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {fmt(e.created_at)} · {e.actor_email}
                  </span>
                </div>
                <p className="text-muted">
                  {e.produto_id ? (
                    <Link href={`/produtos/${e.produto_id}`} className="underline hover:text-foreground">
                      {e.nome}
                    </Link>
                  ) : e.entidade === "lote" && e.entidade_id ? (
                    <Link href={`/lote/${e.entidade_id}`} className="underline hover:text-foreground">
                      {e.nome ?? "Lote"}
                    </Link>
                  ) : (
                    (e.nome ?? (e.entidade_id ? `${e.entidade} #${e.entidade_id}` : e.entidade))
                  )}
                </p>
                {Boolean(e.antes || e.depois || e.resultado_api) && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Detalhes</summary>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["Antes", e.antes],
                          ["Depois", e.depois],
                          ["Resposta da loja", e.resultado_api],
                        ] as const
                      ).map(([label, value]) =>
                        json(value) ? (
                          <div key={label}>
                            <p className="text-xs font-medium text-muted">{label}</p>
                            <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-background p-2 text-xs">{json(value)}</pre>
                          </div>
                        ) : null,
                      )}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {result.pages > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-3">
          {result.page > 1 ? (
            <Link href={href(result.page - 1)} className={buttonClass("outline")}>
              Mais recentes
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Página {result.page} de {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={href(result.page + 1)} className={buttonClass("outline")}>
              Mais antigos
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
