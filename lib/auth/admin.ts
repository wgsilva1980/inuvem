import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { queryOne } from "@/lib/db";

export interface AdminSession {
  email: string;
  name: string;
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const row = await queryOne<{ email: string }>("SELECT email FROM admins WHERE email = $1", [email.trim().toLowerCase()]);
  return row !== null;
}

/**
 * Devolve o admin da sessão atual ou null.
 * Exige e-mail verificado: sem isso, alguém poderia criar uma conta (e-mail+senha) com o e-mail
 * de um admin e herdar o acesso.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.email || user.emailVerified !== true) return null;
  const email = user.email.trim().toLowerCase();
  if (!(await isAdminEmail(email))) return null;
  return { email, name: user.name ?? email };
}

/** Para páginas e Server Actions: redireciona ao login se não for admin. */
export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");
  return admin;
}

/** Para Route Handlers: devolve a sessão ou uma Response 401/403 padronizada. */
export async function requireAdminApi(): Promise<AdminSession | Response> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const admin = await getAdminSession();
  if (!admin) return Response.json({ error: "Seu e-mail não tem acesso a este painel." }, { status: 403 });
  return admin;
}
