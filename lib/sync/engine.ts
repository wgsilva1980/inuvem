import type { Category, Product } from "@/lib/nuvemshop/types";
import { pruneStale, upsertCategories, upsertProducts, type Db } from "./repo";

export interface SyncCursor {
  page: number;
  per_page: number;
  updated_at_min?: string;
  categoriesDone?: boolean;
  /** Marca d'água gravada ao concluir; vira `updated_at_min` do próximo incremental. */
  watermark: string;
}

export interface SyncTotals {
  products: number;
  variants: number;
  categories: number;
  pages: number;
  pruned_products?: number;
  pruned_categories?: number;
}

export interface SyncRun {
  id: string;
  store_id: string;
  tipo: "full" | "incremental" | "webhook";
  status: "running" | "completed" | "failed";
  cursor: SyncCursor;
  totais: SyncTotals;
  erros: Array<{ at: string; message: string }>;
  started_at: string;
  finished_at: string | null;
}

/** O que o motor precisa da Nuvemshop (facilita testar sem rede). */
export interface SyncSource {
  listCategories(): Promise<Category[]>;
  listProductsPage(p: { page: number; per_page: number; updated_at_min?: string }): Promise<{ items: Product[]; nextPage: number | null }>;
}

export interface StepOptions {
  /** Tempo máximo desta chamada (as funções da Vercel têm timeout). */
  budgetMs: number;
  now?: () => number;
  maxErrors?: number;
}

const PER_PAGE = 200;
const WATERMARK_SKEW_MS = 60_000;
const COLUMNS = "id, store_id, tipo, status, cursor, totais, erros, started_at, finished_at";

async function findRunning(db: Db, storeId: string): Promise<SyncRun | null> {
  const rows = await db.query<SyncRun>(
    `SELECT ${COLUMNS} FROM sync_runs WHERE store_id = $1::uuid AND status = 'running' AND tipo <> 'webhook' LIMIT 1`,
    [storeId],
  );
  return rows[0] ?? null;
}

/** Retoma a sincronização em andamento ou cria uma nova. `auto` escolhe incremental se já houve uma completa. */
export async function startOrResumeRun(
  db: Db,
  storeId: string,
  tipo: "full" | "incremental" | "auto",
  now: () => number = Date.now,
): Promise<SyncRun> {
  const running = await findRunning(db, storeId);
  if (running) return running;

  const last = await db.query<{ watermark: string | null }>(
    `SELECT cursor->>'watermark' AS watermark FROM sync_runs
     WHERE store_id = $1::uuid AND status = 'completed' AND tipo IN ('full', 'incremental')
     ORDER BY started_at DESC LIMIT 1`,
    [storeId],
  );
  const since = last[0]?.watermark ?? undefined;
  const effective: "full" | "incremental" = tipo === "full" ? "full" : since ? "incremental" : "full";

  const cursor: SyncCursor = {
    page: 1,
    per_page: PER_PAGE,
    watermark: new Date(now() - WATERMARK_SKEW_MS).toISOString(),
    ...(effective === "incremental" ? { updated_at_min: since } : {}),
  };
  try {
    const rows = await db.query<SyncRun>(
      `INSERT INTO sync_runs (store_id, tipo, cursor, totais) VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb) RETURNING ${COLUMNS}`,
      [storeId, effective, JSON.stringify(cursor), JSON.stringify({ products: 0, variants: 0, categories: 0, pages: 0 })],
    );
    return rows[0]!;
  } catch (err) {
    // Outra chamada criou a execução primeiro (índice único): usa a dela.
    if ((err as { code?: string }).code === "23505") {
      const again = await findRunning(db, storeId);
      if (again) return again;
    }
    throw err;
  }
}

async function persist(db: Db, run: SyncRun): Promise<void> {
  await db.query(
    "UPDATE sync_runs SET cursor = $2::jsonb, totais = $3::jsonb, erros = $4::jsonb, updated_at = now() WHERE id = $1::uuid",
    [run.id, JSON.stringify(run.cursor), JSON.stringify(run.totais), JSON.stringify(run.erros)],
  );
}

/** Processa páginas até acabar o orçamento de tempo. `done` indica que a execução foi concluída. */
export async function stepRun(db: Db, source: SyncSource, input: SyncRun, opts: StepOptions): Promise<{ run: SyncRun; done: boolean }> {
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.budgetMs;
  const run: SyncRun = structuredClone(input);

  try {
    if (!run.cursor.categoriesDone) {
      run.totais.categories = await upsertCategories(db, run.store_id, await source.listCategories());
      run.cursor.categoriesDone = true;
      await persist(db, run);
    }

    for (;;) {
      const { page, per_page, updated_at_min } = run.cursor;
      const result = await source.listProductsPage({ page, per_page, updated_at_min });
      const counts = await upsertProducts(db, run.store_id, result.items);
      run.totais.products += counts.products;
      run.totais.variants += counts.variants;
      run.totais.pages += 1;

      const next = result.nextPage ?? (result.items.length >= per_page ? page + 1 : null);
      if (next === null) {
        if (run.tipo === "full") {
          const pruned = await pruneStale(db, run.store_id, run.started_at);
          run.totais.pruned_products = pruned.products;
          run.totais.pruned_categories = pruned.categories;
        }
        run.status = "completed";
        run.finished_at = new Date(now()).toISOString();
        await db.query(
          "UPDATE sync_runs SET status = 'completed', finished_at = now(), cursor = $2::jsonb, totais = $3::jsonb, updated_at = now() WHERE id = $1::uuid",
          [run.id, JSON.stringify(run.cursor), JSON.stringify(run.totais)],
        );
        return { run, done: true };
      }

      run.cursor.page = next;
      await persist(db, run);
      if (now() >= deadline) return { run, done: false };
    }
  } catch (err) {
    run.erros.push({ at: new Date(now()).toISOString(), message: err instanceof Error ? err.message : String(err) });
    const failed = run.erros.length >= (opts.maxErrors ?? 5);
    if (failed) run.status = "failed";
    await persist(db, run);
    if (failed) await db.query("UPDATE sync_runs SET status = 'failed', finished_at = now() WHERE id = $1::uuid", [run.id]);
    throw err;
  }
}
