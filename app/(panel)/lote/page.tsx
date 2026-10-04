import Link from "next/link";
import { Card } from "@/components/ui/card";
import { STATUS_LABEL } from "@/lib/bulk/format";
import { listJobs } from "@/lib/bulk/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default async function LotesPage() {
  const store = await getActiveStore();
  const jobs = store ? await listJobs({ query }, store.id) : [];
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Operações em massa</h1>
      <p className="text-sm text-muted">Para criar uma, marque produtos em Produtos (ou use "Aplicar a todos os resultados do filtro").</p>
      <Card className="p-0 sm:p-0">
        {jobs.length === 0 ? (
          <p className="p-6 text-sm text-muted">Nenhuma operação em massa ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/lote/${j.id}`} className="flex flex-col gap-1 p-4 hover:bg-border/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{j.descricao}</p>
                    <p className="text-xs text-muted">
                      {fmt(j.created_at)} · {j.actor_email}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span>
                      {j.counts.ok}/{j.counts.total} produtos
                      {j.counts.error + j.counts.conflict > 0 ? <span className="text-danger"> · {j.counts.error + j.counts.conflict} com problema</span> : null}
                    </span>
                    <span className="text-muted">{STATUS_LABEL[j.status]}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
