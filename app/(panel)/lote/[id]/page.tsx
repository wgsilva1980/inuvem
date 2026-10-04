import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ITEM_LABEL, STATUS_LABEL, describeChanges } from "@/lib/bulk/format";
import { getJob, getJobCounts, getJobItems } from "@/lib/bulk/repo";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { JobControls } from "./job-controls";

export const dynamic = "force-dynamic";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const PREVIEW_LIMIT = 100;

export default async function LotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ todos?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { todos } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const store = await getActiveStore();
  if (!store) notFound();
  const db = { query };
  const job = await getJob(db, store.id, id);
  if (!job) notFound();

  const [counts, categories, reverted] = await Promise.all([
    getJobCounts(db, id),
    listCategoryOptions(db, store.id),
    db.query<{ id: string }>("SELECT id FROM bulk_jobs WHERE reverts_job_id = $1::uuid LIMIT 1", [id]),
  ]);
  const showAll = todos === "1";
  const items = await getJobItems(db, id, { limit: showAll ? 100000 : PREVIEW_LIMIT });
  const nameOf = (cid: number) => categories.find((c) => c.id === cid)?.name ?? `#${cid}`;

  const finished = job.status === "completed" || job.status === "cancelled";
  const canRevert = finished && job.operation.type !== "reverter" && counts.ok + counts.error > 0 && reverted.length === 0;
  const ignorados = job.ignorados ?? [];

  return (
    <main className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/lote" className="text-sm text-muted hover:underline">
          ← Lotes
        </Link>
        <h1 className="text-xl font-semibold">{job.descricao}</h1>
        <p className="text-sm text-muted">
          {STATUS_LABEL[job.status]} · criado por {job.actor_email} em {fmt(job.created_at)}
          {job.finished_at ? ` · terminou em ${fmt(job.finished_at)}` : ""}
        </p>
        {job.reverts_job_id && (
          <p className="text-sm">
            Este lote reverte{" "}
            <Link className="underline" href={`/lote/${job.reverts_job_id}`}>
              outro lote
            </Link>
            .
          </p>
        )}
        {reverted[0] && (
          <p className="text-sm">
            Este lote já foi revertido pelo{" "}
            <Link className="underline" href={`/lote/${reverted[0].id}`}>
              lote de reversão
            </Link>
            .
          </p>
        )}
      </div>

      <Card className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-muted">Produtos</dt>
            <dd className="text-2xl font-semibold">{counts.total}</dd>
          </div>
          <div>
            <dt className="text-muted">Variantes</dt>
            <dd className="text-2xl font-semibold">{counts.variants}</dd>
          </div>
          <div>
            <dt className="text-muted">Aplicados</dt>
            <dd className="text-2xl font-semibold text-success">{counts.ok}</dd>
          </div>
          <div>
            <dt className="text-muted">Erros / conflitos</dt>
            <dd className={`text-2xl font-semibold ${counts.error + counts.conflict > 0 ? "text-danger" : ""}`}>
              {counts.error} / {counts.conflict}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Ignorados</dt>
            <dd className="text-2xl font-semibold">{ignorados.length}</dd>
          </div>
        </dl>
        <JobControls
          jobId={job.id}
          status={job.status}
          counts={counts}
          produtos={counts.total}
          variantes={counts.variants}
          canRevert={canRevert}
          descricao={job.descricao}
        />
        {job.status === "preview" && (
          <p className="text-sm text-muted">
            Esta é uma pré-visualização: nada foi enviado à loja. Ao aplicar, cada produto é conferido na loja antes de alterar; se alguém mudou o produto nesse intervalo, ele fica de fora (conflito).
          </p>
        )}
      </Card>

      <Card className="p-0 sm:p-0">
        <h2 className="border-b border-border p-4 text-base font-semibold">{job.status === "preview" ? "O que vai mudar" : "Alterações"}</h2>
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nenhuma alteração neste lote.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.seq} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/produtos/${it.product_id}`} className="font-medium hover:underline">
                    {it.product_name}
                  </Link>
                  {job.status !== "preview" && (
                    <span className={it.status === "ok" ? "text-success" : it.status === "pending" || it.status === "processing" ? "text-muted" : "text-danger"}>{ITEM_LABEL[it.status]}</span>
                  )}
                </div>
                <ul className="text-muted">
                  {describeChanges(it.changes, nameOf).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {it.resultado?.mensagem && <p className="text-danger">{it.resultado.mensagem}</p>}
              </li>
            ))}
          </ul>
        )}
        {!showAll && counts.total > PREVIEW_LIMIT && (
          <p className="border-t border-border p-4 text-sm">
            Mostrando {PREVIEW_LIMIT} de {counts.total}.{" "}
            <Link className="underline" href={`/lote/${job.id}?todos=1`}>
              Mostrar todos
            </Link>
          </p>
        )}
      </Card>

      {ignorados.length > 0 && (
        <Card>
          <details>
            <summary className="cursor-pointer text-base font-semibold">Ignorados ({ignorados.length})</summary>
            <p className="mt-2 text-sm text-muted">Não serão alterados, pelo motivo indicado.</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {ignorados.slice(0, 300).map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.productName}</span>
                  {s.variant ? ` (${s.variant})` : ""}: <span className="text-muted">{s.motivo}</span>
                </li>
              ))}
            </ul>
            {ignorados.length > 300 && <p className="mt-2 text-sm text-muted">… e mais {ignorados.length - 300}.</p>}
          </details>
        </Card>
      )}
    </main>
  );
}
