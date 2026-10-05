import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { RevisaoConfigError, criarRevisor, resumoRevisao, revisarPendentes } from "@/lib/images/review";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Revisa mais um pedaço das fotos com o Claude (a tela repete até `restantes` ser falso). Retomável: os resultados ficam no banco. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { maxFotos?: unknown; ignorar?: unknown };
  const maxFotos = Number.isInteger(body.maxFotos) && (body.maxFotos as number) > 0 ? Math.min(body.maxFotos as number, 500) : undefined;
  const ignorar = Array.isArray(body.ignorar) ? body.ignorar.filter((s): s is string => typeof s === "string" && /^\d+$/.test(s)).slice(0, 2000) : [];
  try {
    const db = { query };
    const r = await revisarPendentes(db, { storeId: store.id, budgetMs: 25_000, revisor: criarRevisor(), maxFotos, ignorar });
    const resumo = await resumoRevisao(db, store.id);
    return Response.json({ ...r, revisadasTotal: resumo.revisadas, fotos: resumo.fotos });
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "image.review.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao revisar as imagens." }, { status: 500 });
  }
}
