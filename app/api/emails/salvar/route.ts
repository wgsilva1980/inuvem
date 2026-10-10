import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { EMAIL_CORPO_MAX, descartar, editarReescrita, marcarColado } from "@/lib/emails/repo";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Edita o texto novo, marca como "colado na loja" (ou desmarca) ou descarta a reescrita. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const b = (await request.json().catch(() => ({}))) as { key?: unknown; acao?: unknown; assunto?: unknown; corpo?: unknown };
  if (typeof b.key !== "string" || !b.key) return Response.json({ error: "Informe o e-mail." }, { status: 400 });
  const db = { query };
  const audit = (acao: string, depois: unknown) =>
    db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, $3, 'email', $4, $5::jsonb, true)`, [store.id, admin.email, acao, b.key as string, JSON.stringify(depois)]);

  if (b.acao === "colado" || b.acao === "pendente") {
    const ok = await marcarColado(db, store.id, b.key, b.acao === "colado");
    if (!ok) return Response.json({ error: "E-mail não encontrado." }, { status: 404 });
    if (b.acao === "colado") await audit("email.colado", {});
    return Response.json({ ok: true });
  }
  if (b.acao === "descartar") {
    if (!(await descartar(db, store.id, b.key))) return Response.json({ error: "E-mail não encontrado." }, { status: 404 });
    return Response.json({ ok: true });
  }
  if (typeof b.assunto !== "string" || typeof b.corpo !== "string" || !b.corpo.trim()) return Response.json({ error: "O corpo do e-mail não pode ficar vazio." }, { status: 400 });
  if (b.corpo.length > EMAIL_CORPO_MAX || b.assunto.length > 500) return Response.json({ error: "O texto é grande demais." }, { status: 400 });
  const r = await editarReescrita(db, store.id, b.key, b.assunto.trim(), b.corpo.trim());
  if (!r) return Response.json({ error: "E-mail não encontrado." }, { status: 404 });
  return Response.json(r);
}
