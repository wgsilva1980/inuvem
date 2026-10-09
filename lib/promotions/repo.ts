import { operationSchema, type BulkOperation } from "@/lib/bulk/operations";
import type { Db } from "@/lib/sync/repo";

export type PromoStatus = "agendada" | "aplicando" | "ativa" | "encerrando" | "encerrada" | "cancelada";

export const STATUS_LABEL: Record<PromoStatus, string> = {
  agendada: "Agendada",
  aplicando: "Aplicando",
  ativa: "No ar",
  encerrando: "Encerrando",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};

export class PromocaoError extends Error {}

export interface Promocao {
  id: string;
  store_id: string;
  nome: string;
  operation: BulkOperation;
  product_ids: string[];
  starts_at: string;
  ends_at: string;
  status: PromoStatus;
  apply_job_id: string | null;
  revert_job_id: string | null;
  nota: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const COLUMNS = `id, store_id, nome, operation, product_ids::text[] AS product_ids, starts_at::text AS starts_at, ends_at::text AS ends_at, status, apply_job_id, revert_job_id,
  nota, created_by, created_at::text AS created_at, started_at::text AS started_at, ended_at::text AS ended_at`;

/** Data e hora digitadas na tela (aaaa-mm-ddThh:mm) valem no horário de Brasília. */
export const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SP = "AT TIME ZONE 'America/Sao_Paulo'";

export async function createPromotion(
  db: Db,
  args: { storeId: string; actor: string; nome: string; operation: BulkOperation; productIds: number[]; inicioLocal: string; fimLocal: string },
): Promise<string> {
  const nome = args.nome.trim().slice(0, 120);
  if (nome === "") throw new PromocaoError("Dê um nome para a promoção.");
  if (!LOCAL_DATETIME.test(args.inicioLocal) || !LOCAL_DATETIME.test(args.fimLocal)) throw new PromocaoError("Informe o início e o fim da promoção.");
  if (args.productIds.length === 0) throw new PromocaoError("Nenhum produto selecionado.");
  const op = operationSchema.parse(args.operation);
  if (op.type !== "promocao" || op.mode !== "desconto") throw new PromocaoError("Operação inválida para uma promoção.");

  const [range] = await db.query<{ ok: boolean; futuro: boolean }>(
    `SELECT ($2::timestamp ${SP}) > ($1::timestamp ${SP}) AS ok, ($2::timestamp ${SP}) > now() AS futuro`,
    [args.inicioLocal, args.fimLocal],
  );
  if (!range?.ok) throw new PromocaoError("O fim precisa ser depois do início.");
  if (!range.futuro) throw new PromocaoError("O fim da promoção já passou.");

  // um produto não pode estar em duas promoções ao mesmo tempo: a segunda desfaria a primeira
  const conflito = await db.query<{ nome: string }>(
    `SELECT nome FROM promotions
     WHERE store_id = $1::uuid AND status NOT IN ('encerrada', 'cancelada') AND product_ids && $2::bigint[]
       AND starts_at < ($4::timestamp ${SP}) AND ends_at > ($3::timestamp ${SP}) LIMIT 1`,
    [args.storeId, args.productIds, args.inicioLocal, args.fimLocal],
  );
  if (conflito[0]) throw new PromocaoError(`Há produtos desta seleção na promoção “${conflito[0].nome}”, que se sobrepõe a estas datas. Ajuste as datas ou os produtos.`);

  const rows = await db.query<{ id: string }>(
    `INSERT INTO promotions (store_id, nome, operation, product_ids, starts_at, ends_at, created_by)
     VALUES ($1::uuid, $2, $3::jsonb, $4::bigint[], ($5::timestamp ${SP}), ($6::timestamp ${SP}), $7) RETURNING id`,
    [args.storeId, nome, JSON.stringify(op), args.productIds, args.inicioLocal, args.fimLocal, args.actor],
  );
  return rows[0]!.id;
}

export async function getPromotion(db: Db, storeId: string, id: string): Promise<Promocao | null> {
  const rows = await db.query<Promocao>(`SELECT ${COLUMNS} FROM promotions WHERE id = $1::uuid AND store_id = $2::uuid`, [id, storeId]);
  return rows[0] ?? null;
}

export async function listPromotions(db: Db, storeId: string, limit = 50): Promise<Promocao[]> {
  return db.query<Promocao>(
    `SELECT ${COLUMNS} FROM promotions WHERE store_id = $1::uuid
     ORDER BY CASE WHEN status IN ('encerrada', 'cancelada') THEN 1 ELSE 0 END, starts_at DESC LIMIT ${limit}`,
    [storeId],
  );
}

/** Só uma promoção que ainda não começou pode ser cancelada (depois disso, encerre-a: o preço volta ao que era). */
export async function cancelPromotion(db: Db, storeId: string, id: string): Promise<boolean> {
  const rows = await db.query(
    "UPDATE promotions SET status = 'cancelada', ended_at = now() WHERE id = $1::uuid AND store_id = $2::uuid AND status = 'agendada' RETURNING id",
    [id, storeId],
  );
  return rows.length > 0;
}

/** Promoções que precisam de atenção agora: começar, encerrar ou continuar o que ficou pela metade. */
export async function listDue(db: Db, storeId: string): Promise<Promocao[]> {
  return db.query<Promocao>(
    `SELECT ${COLUMNS} FROM promotions WHERE store_id = $1::uuid AND (
       status IN ('aplicando', 'encerrando') OR (status = 'agendada' AND starts_at <= now()) OR (status = 'ativa' AND ends_at <= now()))
     ORDER BY CASE status WHEN 'encerrando' THEN 0 WHEN 'ativa' THEN 1 WHEN 'aplicando' THEN 2 ELSE 3 END, starts_at`,
    [storeId],
  );
}
