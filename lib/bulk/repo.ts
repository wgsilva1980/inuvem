import type { Db } from "@/lib/sync/repo";
import { pt, type I18n } from "@/lib/nuvemshop/types";
import type { BulkOperation, ItemChanges, MirrorProduct, Plan, Skipped } from "./operations";

export type JobStatus = "preview" | "running" | "completed" | "cancelled";
export type ItemStatus = "pending" | "processing" | "ok" | "error" | "conflict";

export interface Job {
  id: string;
  store_id: string;
  actor_email: string;
  operation: BulkOperation | { type: "reverter"; of: string };
  descricao: string;
  status: JobStatus;
  reverts_job_id: string | null;
  ignorados: Skipped[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobCounts {
  total: number;
  pending: number;
  ok: number;
  error: number;
  conflict: number;
  variants: number;
}

export interface JobItem {
  seq: number;
  product_id: string;
  product_name: string;
  changes: ItemChanges;
  status: ItemStatus;
  resultado: ItemResult | null;
}

/** Partes de um produto que o lote tentou alterar e o que aconteceu com cada uma. */
export interface ItemResult {
  partes?: Array<{ tipo: "produto" | "variante"; id?: number; ok: boolean; erro?: string }>;
  mensagem?: string;
}

const JOB_COLUMNS = "id, store_id, actor_email, operation, descricao, status, reverts_job_id, ignorados, created_at, started_at, finished_at";

export class JobStateError extends Error {}

const variantLabel = (values: Array<Record<string, string | null>> | null): string =>
  (values ?? [])
    .map((x) => Object.values(x)[0])
    .filter(Boolean)
    .join(" / ") || "Padrão";

/** Estado atual dos produtos (e variantes) no espelho, para calcular a pré-visualização. */
export async function loadMirrorProducts(db: Db, storeId: string, ids: number[]): Promise<MirrorProduct[]> {
  if (ids.length === 0) return [];
  const rows = await db.query<{
    id: string;
    name: string;
    published: boolean;
    categories: Array<{ id: number }>;
    attributes: unknown;
    variants: Array<{ id: string; sku: string | null; values: Array<Record<string, string | null>>; price: string | null; promotional_price: string | null; stock_management: boolean; stock: number | null }>;
  }>(
    `SELECT p.id::text AS id, p.name, p.published, p.categories, coalesce(p.raw_json->'attributes', '[]'::jsonb) AS attributes,
            coalesce(jsonb_agg(jsonb_build_object('id', v.id::text, 'sku', v.sku, 'values', v.values, 'price', v.price::text,
                     'promotional_price', v.promotional_price::text, 'stock_management', v.stock_management, 'stock', v.stock)
                     ORDER BY v.position NULLS LAST, v.id) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS variants
     FROM products p
     LEFT JOIN variants v ON v.store_id = p.store_id AND v.product_id = p.id
     WHERE p.store_id = $1::uuid AND p.id = ANY($2::bigint[])
     GROUP BY p.store_id, p.id
     ORDER BY lower(p.name), p.id`,
    [storeId, ids],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    published: r.published,
    categoryIds: (r.categories ?? []).map((c) => Number(c.id)),
    attributes: Array.isArray(r.attributes) ? r.attributes.map((a) => pt(a as I18n)) : [],
    variants: r.variants.map((v) => ({
      id: Number(v.id),
      sku: v.sku,
      label: variantLabel(v.values),
      price: v.price === null ? null : Number(v.price),
      promotional_price: v.promotional_price === null ? null : Number(v.promotional_price),
      stock_management: v.stock_management,
      stock: v.stock,
    })),
  }));
}

export async function createJob(
  db: Db,
  args: { storeId: string; actor: string; operation: Job["operation"]; descricao: string; plan: Plan; revertsJobId?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO bulk_jobs (store_id, actor_email, operation, descricao, reverts_job_id, ignorados)
     VALUES ($1::uuid, $2, $3::jsonb, $4, $5::uuid, $6::jsonb) RETURNING id`,
    [args.storeId, args.actor, JSON.stringify(args.operation), args.descricao, args.revertsJobId ?? null, JSON.stringify(args.plan.ignorados.slice(0, 2000))],
  );
  const id = rows[0]!.id;
  if (args.plan.items.length > 0) {
    const items = args.plan.items.map((it, i) => ({ seq: i + 1, product_id: it.productId, product_name: it.productName, changes: it.changes }));
    await db.query(
      `INSERT INTO bulk_job_items (job_id, seq, product_id, product_name, changes)
       SELECT $1::uuid, r.seq, r.product_id, r.product_name, r.changes
       FROM jsonb_to_recordset($2::jsonb) AS r(seq int, product_id bigint, product_name text, changes jsonb)`,
      [id, JSON.stringify(items)],
    );
  }
  return id;
}

export async function getJob(db: Db, storeId: string, id: string): Promise<Job | null> {
  const rows = await db.query<Job>(`SELECT ${JOB_COLUMNS} FROM bulk_jobs WHERE id = $1::uuid AND store_id = $2::uuid`, [id, storeId]);
  return rows[0] ?? null;
}

export async function getJobCounts(db: Db, jobId: string): Promise<JobCounts> {
  const rows = await db.query<{ status: ItemStatus; n: string; variants: string }>(
    `SELECT status, count(*)::text AS n, coalesce(sum(jsonb_array_length(changes->'variants')), 0)::text AS variants
     FROM bulk_job_items WHERE job_id = $1::uuid GROUP BY status`,
    [jobId],
  );
  const c: JobCounts = { total: 0, pending: 0, ok: 0, error: 0, conflict: 0, variants: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    c.total += n;
    c.variants += Number(r.variants);
    if (r.status === "pending" || r.status === "processing") c.pending += n;
    else c[r.status] += n;
  }
  return c;
}

export async function getJobItems(db: Db, jobId: string, opts: { limit?: number; offset?: number; onlyProblems?: boolean } = {}): Promise<JobItem[]> {
  return db.query<JobItem>(
    `SELECT seq, product_id::text AS product_id, product_name, changes, status, resultado
     FROM bulk_job_items WHERE job_id = $1::uuid ${opts.onlyProblems ? "AND status IN ('error', 'conflict')" : ""}
     ORDER BY seq LIMIT ${opts.limit ?? 100000} OFFSET ${opts.offset ?? 0}`,
    [jobId],
  );
}

export async function listJobs(db: Db, storeId: string, limit = 30): Promise<Array<Job & { counts: JobCounts }>> {
  const jobs = await db.query<Job>(`SELECT ${JOB_COLUMNS} FROM bulk_jobs WHERE store_id = $1::uuid ORDER BY created_at DESC LIMIT ${limit}`, [storeId]);
  return Promise.all(jobs.map(async (j) => ({ ...j, counts: await getJobCounts(db, j.id) })));
}

/** preview -> running. Falha se já houver outro lote em execução nesta loja (índice único). */
export async function startJob(db: Db, storeId: string, id: string): Promise<void> {
  let rows: Array<{ id: string }>;
  try {
    rows = await db.query<{ id: string }>(
      `UPDATE bulk_jobs SET status = 'running', started_at = now() WHERE id = $1::uuid AND store_id = $2::uuid AND status = 'preview' RETURNING id`,
      [id, storeId],
    );
  } catch {
    throw new JobStateError("Já existe um lote em execução. Espere terminar ou cancele esse lote antes de aplicar outro.");
  }
  if (rows.length === 0) throw new JobStateError("Este lote não está mais aguardando confirmação.");
}

export async function cancelJob(db: Db, storeId: string, id: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE bulk_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1::uuid AND store_id = $2::uuid AND status IN ('preview', 'running') RETURNING id`,
    [id, storeId],
  );
  return rows.length > 0;
}

/** Pega até `limit` produtos pendentes (ou travados há mais de 2 min). SKIP LOCKED: dois "passos" simultâneos nunca pegam o mesmo item. */
export async function claimItems(db: Db, jobId: string, limit: number): Promise<JobItem[]> {
  const items = await db.query<JobItem>(
    `UPDATE bulk_job_items i SET status = 'processing', claimed_at = now()
     WHERE (i.job_id, i.seq) IN (
       SELECT job_id, seq FROM bulk_job_items
       WHERE job_id = $1::uuid AND (status = 'pending' OR (status = 'processing' AND claimed_at < now() - interval '2 minutes'))
       ORDER BY seq LIMIT ${limit} FOR UPDATE SKIP LOCKED)
     RETURNING i.seq, i.product_id::text AS product_id, i.product_name, i.changes, i.status, i.resultado`,
    [jobId],
  );
  // O RETURNING não garante ordem: processa sempre na ordem da pré-visualização (progresso e histórico previsíveis).
  return items.sort((a, b) => a.seq - b.seq);
}

export async function completeItem(db: Db, jobId: string, seq: number, status: "ok" | "error" | "conflict", resultado: ItemResult): Promise<void> {
  await db.query(
    `UPDATE bulk_job_items SET status = $3, resultado = $4::jsonb, executed_at = now() WHERE job_id = $1::uuid AND seq = $2`,
    [jobId, seq, status, JSON.stringify(resultado)],
  );
}

/** running -> completed quando não sobra nada pendente. */
export async function finishIfDone(db: Db, jobId: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE bulk_jobs SET status = 'completed', finished_at = now()
     WHERE id = $1::uuid AND status = 'running'
       AND NOT EXISTS (SELECT 1 FROM bulk_job_items WHERE job_id = $1::uuid AND status IN ('pending', 'processing'))
     RETURNING id`,
    [jobId],
  );
  return rows.length > 0;
}

export async function jobStatus(db: Db, jobId: string): Promise<JobStatus | null> {
  const rows = await db.query<{ status: JobStatus }>("SELECT status FROM bulk_jobs WHERE id = $1::uuid", [jobId]);
  return rows[0]?.status ?? null;
}
