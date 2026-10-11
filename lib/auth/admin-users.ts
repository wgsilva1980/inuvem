import { z } from "zod";
import { ehPerfil, type Perfil } from "@/lib/auth/perfis";
import type { Db } from "@/lib/sync/repo";

export interface AdminUser {
  email: string;
  created_at: string;
  perfil: Perfil;
}

export class AdminUserError extends Error {}

const emailSchema = z.string().trim().toLowerCase().max(254).email();

/** E-mail normalizado (minúsculas, sem espaços) ou null se não parece um e-mail. */
export function normalizeEmail(raw: string): string | null {
  const r = emailSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function listAdmins(db: Db): Promise<AdminUser[]> {
  return db.query<AdminUser>("SELECT email, created_at, perfil FROM admins ORDER BY created_at, email");
}

async function audit(db: Db, a: { storeId: string | null; actor: string; acao: string; email: string; perfil?: Perfil; antes?: Perfil; sucesso?: boolean }) {
  if (!a.storeId) return; // o histórico é por loja; sem loja conectada não há onde registrar
  await db.query(
    `INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso)
     VALUES ($1::uuid, $2, $3, 'usuario', $4, $5::jsonb, $6)`,
    [a.storeId, a.actor, a.acao, a.email, JSON.stringify({ email: a.email, ...(a.perfil ? { perfil: a.perfil } : {}), ...(a.antes ? { perfil_antes: a.antes } : {}) }), a.sucesso ?? true],
  );
}

/** Libera um e-mail no painel. Devolve false se ele já tinha acesso. */
export async function addAdmin(db: Db, args: { actor: string; email: string; storeId: string | null; perfil?: Perfil }): Promise<{ email: string; created: boolean }> {
  const email = normalizeEmail(args.email);
  if (!email) throw new AdminUserError("Informe um e-mail válido, como nome@dominio.com.");
  const perfil = args.perfil ?? "admin";
  if (!ehPerfil(perfil)) throw new AdminUserError("Perfil inválido.");
  const rows = await db.query<{ email: string }>("INSERT INTO admins (email, perfil) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING email", [email, perfil]);
  if (rows.length > 0) await audit(db, { storeId: args.storeId, actor: args.actor, acao: "usuario.adicionar", email, perfil });
  return { email, created: rows.length > 0 };
}

/** Tira o acesso de um e-mail. Não deixa remover a si mesmo nem o último usuário. */
export async function removeAdmin(db: Db, args: { actor: string; email: string; storeId: string | null }): Promise<void> {
  const email = normalizeEmail(args.email);
  if (!email) throw new AdminUserError("E-mail inválido.");
  if (email === args.actor.trim().toLowerCase()) throw new AdminUserError("Você não pode remover o seu próprio acesso. Peça a outro usuário para fazer isso.");
  const total = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM admins");
  if ((total[0]?.n ?? 0) <= 1) throw new AdminUserError("Este é o último usuário com acesso; não dá para remover.");
  const alvo = await db.query<{ perfil: string }>("SELECT perfil FROM admins WHERE email = $1", [email]);
  if (alvo[0]?.perfil === "admin" && (await outrosAdministradores(db, email)) === 0) throw new AdminUserError("Este é o último administrador; sem ele ninguém consegue gerenciar o painel.");
  const rows = await db.query<{ email: string }>("DELETE FROM admins WHERE email = $1 RETURNING email", [email]);
  if (rows.length === 0) throw new AdminUserError("Esse e-mail não está na lista.");
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "usuario.remover", email });
}

/** Quantos usuários com perfil Administrador existem além deste e-mail. */
async function outrosAdministradores(db: Db, email: string): Promise<number> {
  const [r] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM admins WHERE perfil = 'admin' AND email <> $1", [email]);
  return r?.n ?? 0;
}

/** Troca o perfil de um usuário. Não deixa mudar o próprio perfil nem tirar o último administrador. */
export async function setPerfil(db: Db, args: { actor: string; email: string; perfil: Perfil; storeId: string | null }): Promise<{ mudou: boolean }> {
  const email = normalizeEmail(args.email);
  if (!email) throw new AdminUserError("E-mail inválido.");
  if (!ehPerfil(args.perfil)) throw new AdminUserError("Perfil inválido.");
  if (email === args.actor.trim().toLowerCase()) throw new AdminUserError("Você não pode mudar o seu próprio perfil. Peça a outro administrador.");
  const [atual] = await db.query<{ perfil: Perfil }>("SELECT perfil FROM admins WHERE email = $1", [email]);
  if (!atual) throw new AdminUserError("Esse e-mail não está na lista.");
  if (atual.perfil === args.perfil) return { mudou: false };
  if (atual.perfil === "admin" && (await outrosAdministradores(db, email)) === 0) throw new AdminUserError("Este é o último administrador; não dá para mudar o perfil dele.");
  await db.query("UPDATE admins SET perfil = $2 WHERE email = $1", [email, args.perfil]);
  await audit(db, { storeId: args.storeId, actor: args.actor, acao: "usuario.perfil", email, perfil: args.perfil, antes: atual.perfil });
  return { mudou: true };
}
