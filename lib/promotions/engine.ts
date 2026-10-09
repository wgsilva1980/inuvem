import { createRevertJob, stepJob, type BulkApi } from "@/lib/bulk/engine";
import { describeOperation, planOperation } from "@/lib/bulk/operations";
import { JobStateError, cancelJob, createJob, getJob, getJobCounts, loadMirrorProducts, startJob, type JobCounts } from "@/lib/bulk/repo";
import type { Db } from "@/lib/sync/repo";
import { PromocaoError, getPromotion, listDue, type PromoStatus, type Promocao } from "./repo";

export interface PassoPromocao {
  status: PromoStatus;
  /** Nada mais a fazer agora (terminou, ou ainda não é hora). */
  done: boolean;
  counts: JobCounts | null;
  nota: string | null;
}

async function audit(db: Db, p: Promocao, actor: string, acao: string, depois: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, $3, 'promocao', $4, $5::jsonb, true)`,
    [p.store_id, actor, acao, p.id, JSON.stringify({ nome: p.nome, ...depois })],
  );
}

const marcar = (db: Db, id: string, status: PromoStatus, extra = "", params: unknown[] = []) =>
  db.query(`UPDATE promotions SET status = $2${extra ? `, ${extra}` : ""} WHERE id = $1::uuid`, [id, status, ...params]);

/** Aplica o desconto: confere o estado atual do espelho, monta o plano e dispara o lote (que confere a loja produto a produto). */
async function iniciar(db: Db, p: Promocao, actor: string): Promise<void> {
  const claimed = await db.query("UPDATE promotions SET status = 'aplicando', started_at = now() WHERE id = $1::uuid AND status = 'agendada' RETURNING id", [p.id]);
  if (claimed.length === 0) return; // outro passo já pegou
  try {
    const plan = planOperation(p.operation, await loadMirrorProducts(db, p.store_id, p.product_ids.map(Number)));
    if (plan.items.length === 0) {
      const motivos = [...new Set(plan.ignorados.map((i) => i.motivo))].slice(0, 3).join("; ");
      await marcar(db, p.id, "encerrada", "ended_at = now(), nota = $3", [`Nada a alterar${motivos ? `: ${motivos}` : ""}.`]);
      await audit(db, p, actor, "promocao.iniciar", { produtos: 0 });
      return;
    }
    const jobId = await createJob(db, { storeId: p.store_id, actor, operation: p.operation, descricao: `Promoção “${p.nome}” — início: ${describeOperation(p.operation)}`, plan });
    try {
      await startJob(db, p.store_id, jobId);
    } catch (err) {
      await cancelJob(db, p.store_id, jobId);
      throw err;
    }
    await marcar(db, p.id, "aplicando", "apply_job_id = $3::uuid", [jobId]);
    await audit(db, p, actor, "promocao.iniciar", { produtos: plan.items.length, lote: jobId });
  } catch (err) {
    await marcar(db, p.id, "agendada", "started_at = NULL");
    if (err instanceof JobStateError) throw new PromocaoError(err.message);
    throw err;
  }
}

/** Desfaz: o lote de reversão devolve o preço promocional de antes, pulando o que foi alterado na loja nesse meio-tempo. */
async function encerrar(db: Db, p: Promocao, actor: string): Promise<void> {
  const claimed = await db.query("UPDATE promotions SET status = 'encerrando' WHERE id = $1::uuid AND status = 'ativa' RETURNING id", [p.id]);
  if (claimed.length === 0) return;
  try {
    const revertId = await createRevertJob(db, { storeId: p.store_id, actor, jobId: p.apply_job_id! });
    await startJob(db, p.store_id, revertId);
    await marcar(db, p.id, "encerrando", "revert_job_id = $3::uuid", [revertId]);
    await audit(db, p, actor, "promocao.encerrar", { lote: revertId });
  } catch (err) {
    if (err instanceof JobStateError && /nenhuma alteração/.test(err.message)) {
      await marcar(db, p.id, "encerrada", "ended_at = now(), nota = $3", ["Nada foi alterado na loja; não havia o que desfazer."]);
      return;
    }
    await marcar(db, p.id, "ativa");
    if (err instanceof JobStateError) throw new PromocaoError(err.message);
    throw err;
  }
}

/**
 * Dá o próximo passo de uma promoção. `acao` força o início ("Iniciar agora") ou o fim ("Encerrar agora"); sem ela, só continua
 * o que já está em andamento. Retomável: o progresso fica nos lotes, no banco.
 */
export async function avancarPromocao(
  db: Db,
  api: BulkApi,
  args: { storeId: string; actor: string; id: string; acao?: "iniciar" | "encerrar"; budgetMs: number; now?: () => number },
): Promise<PassoPromocao> {
  let p = await getPromotion(db, args.storeId, args.id);
  if (!p) throw new PromocaoError("Promoção não encontrada.");

  if (args.acao === "iniciar" && p.status === "agendada") await iniciar(db, p, args.actor);
  else if (args.acao === "encerrar" && p.status === "ativa") await encerrar(db, p, args.actor);
  p = (await getPromotion(db, args.storeId, args.id))!;

  const passo = async (jobId: string | null): Promise<{ done: boolean; counts: JobCounts | null }> => {
    if (!jobId) return { done: true, counts: null };
    const r = await stepJob(db, api, { storeId: args.storeId, actor: args.actor, jobId, budgetMs: args.budgetMs, now: args.now });
    return { done: r.done, counts: await getJobCounts(db, jobId) };
  };

  if (p.status === "aplicando") {
    const r = await passo(p.apply_job_id);
    if (r.done) {
      await marcar(db, p.id, "ativa");
      await audit(db, p, args.actor, "promocao.no_ar", { ok: r.counts?.ok ?? 0, erros: (r.counts?.error ?? 0) + (r.counts?.conflict ?? 0) });
      return { status: "ativa", done: true, counts: r.counts, nota: p.nota };
    }
    return { status: "aplicando", done: false, counts: r.counts, nota: p.nota };
  }
  if (p.status === "encerrando") {
    const r = await passo(p.revert_job_id);
    if (r.done) {
      await marcar(db, p.id, "encerrada", "ended_at = now()");
      await audit(db, p, args.actor, "promocao.encerrada", { ok: r.counts?.ok ?? 0, conflitos: r.counts?.conflict ?? 0, erros: r.counts?.error ?? 0 });
      return { status: "encerrada", done: true, counts: r.counts, nota: p.nota };
    }
    return { status: "encerrando", done: false, counts: r.counts, nota: p.nota };
  }
  const job = p.status === "ativa" && p.apply_job_id ? await getJob(db, p.store_id, p.apply_job_id) : null;
  return { status: p.status, done: true, counts: job ? await getJobCounts(db, job.id) : null, nota: p.nota };
}

/**
 * Chamado pelo cron: começa as promoções cuja hora chegou, encerra as que venceram e continua as que ficaram pela metade.
 * Uma promoção que venceu sem nunca ter começado é encerrada sem tocar na loja.
 */
export async function tickPromocoes(db: Db, api: BulkApi, args: { storeId: string; budgetMs: number; now?: () => number }): Promise<{ processadas: number }> {
  const now = args.now ?? Date.now;
  const limite = now() + args.budgetMs;
  let processadas = 0;
  for (const p of await listDue(db, args.storeId)) {
    if (now() >= limite) break;
    if (p.status === "agendada" && new Date(p.ends_at).getTime() <= now()) {
      await marcar(db, p.id, "encerrada", "ended_at = now(), nota = $3", ["O prazo acabou antes de a promoção começar; nada foi alterado na loja."]);
      continue;
    }
    const acao = p.status === "agendada" ? "iniciar" : p.status === "ativa" ? "encerrar" : undefined;
    try {
      for (let i = 0; i < 50 && now() < limite; i++) {
        const r = await avancarPromocao(db, api, { storeId: args.storeId, actor: "cron", id: p.id, acao: i === 0 ? acao : undefined, budgetMs: Math.max(1_000, limite - now()), now: args.now });
        if (r.done) break;
      }
      processadas++;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "promocao.tick_failed", id: p.id, message: err instanceof Error ? err.message : String(err) }));
    }
  }
  return { processadas };
}
