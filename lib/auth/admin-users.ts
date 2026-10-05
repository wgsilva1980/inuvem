import { z } from "zod";
import type { Db } from "@/lib/sync/repo";

export interface AdminUser {
  email: string;
  created_at: string;
}

export class AdminUserError extends Error {}

const emailSchema = z.string().trim().toLowerCase().max(254).email();

/** E-mail normalizado (minúsculas, sem espaços) ou null se não parece um e-mail. */
export function normalizeEmail(raw: string): string | null {
  const r = emailSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function listAdmins(db: Db): Promise<AdminUser[]> {
  return db.query<AdminUser>("SELECT email, created_at FROM admins ORDER BY created_at, email");
}

async function audit(db: Db, a: { storeId: string | null; actor: string; acao: string; email: string; sucesso?: boolean }) {
  if (!a.storeId) return; // o histórico é por loja; sem loja conectada não há onde registrar
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso)
     VALUES ($1::uuid, $2, $3, 'usuario', $4, $5::jsonb, $6)`,
    [a.storeId, a.actor, a.acao, a.email, JSON.stringify({ email: a.email }), a.sucesso ?? true],
  );
}

/** Libera um e-mail no painel. Devolve false se ele já tinha acesso. */
export async function addAdmin(db: Db, args: { actor: string; email: string; storeId: string | null }): Promise<{ email: string; created: boolean }> {
  const email = normalizeEmail(args.email);
  if (!email) throw new AdminUserError("Informe um e-mail válido, como nome@dominio.com.");
  const rows = await db.query<{ email: string }>("INSERT INTO admins (email) VALUES ($1) ON CONFLICT DO NOTHING RETURNING email", [email]);
  if (rows.length > 0) await audit(db, { storeId: args.storeId, actor: args.actor, acao: "usuario.adicionar", email });
  return { email, created: rows.length > 0 };
}

/** Tira o acesso de um e-mail. Não deixa remover a si mesmo nem o último usuário. */
export async function removeAdmin(db: Db, args: { actor: string; email: string; storeId: string | null }): Promise<void> {
  const email = normalizeEmail(args.email);
  if (!email) throw new AdminUserError("E-mail inválido.");
  if (email === args.actor.trim().toLowerCase()) throw new AdminUserError("Você não pode remover o seu próprio acesso. Peça a outro usuário para fazer isso.");
  const total = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM admins");
  if ((total[0]?.n ?? 0) <= 1) throw new AdminUserError("Este é o último usuário com acesso; não dá para remover.");
  const rows = await db.query<{ email: string }>("DELETE FROM admins WHERE email = $1 RETURNING email", [email]);
  if (rows.length === 0) throw new AdminUserError("Esse e-mail não está na lista.");
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "usuario.remover", email });
}
