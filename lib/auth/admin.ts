import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { queryOne } from "@/lib/db";
import { ehPerfil, inicioDoPerfil, podeAcessar, type Area, type Perfil } from "@/lib/auth/perfis";

export interface AdminSession {
  email: string;
  name: string;
  perfil: Perfil;
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
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.email || user.emailVerified !== true) return null;
  const email = user.email.trim().toLowerCase();
  const row = await queryOne<{ perfil: string }>("SELECT perfil FROM admins WHERE email = $1", [email]);
  if (!row) return null;
  return { email, name: user.name ?? email, perfil: ehPerfil(row.perfil) ? row.perfil : "expedicao" }; // perfil desconhecido -> o mais restrito
});

/**
 * Para páginas e Server Actions: redireciona ao login se não for usuário do painel, e ao início do perfil se o perfil não pode abrir esta área.
 *
 * O padrão é negar: sem `area`, só o perfil "admin" passa. Páginas e rotas liberadas para outros perfis dizem a área (`requireAdmin("expedicao")`).
 *
 * Chame em CADA página e ação, não só no layout: o Next pode renderizar uma página sem rodar o layout que a envolve
 * (navegação parcial), então o layout não é uma barreira de autorização. A sessão é memorizada por requisição
 * (`cache`), então chamar de novo no layout e na página custa uma consulta só.
 */
export async function requireAdmin(area?: Area): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");
  if (!podeAcessar(admin.perfil, area)) redirect(inicioDoPerfil(admin.perfil));
  return admin;
}

/** Só confere que é um usuário do painel (qualquer perfil). Para o layout, que não decide por área: cada página decide. */
export async function requireUsuario(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");
  return admin;
}

/** Para Route Handlers: devolve a sessão ou uma Response 401/403 padronizada. Mesma regra de área de `requireAdmin`. */
export async function requireAdminApi(area?: Area): Promise<AdminSession | Response> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return Response.json({ error: "Faça login para continuar." }, { status: 401 });
  const admin = await getAdminSession();
  if (!admin) return Response.json({ error: "Seu e-mail não tem acesso a este painel." }, { status: 403 });
  if (!podeAcessar(admin.perfil, area)) return Response.json({ error: "Seu perfil não tem acesso a esta função." }, { status: 403 });
  return admin;
}
