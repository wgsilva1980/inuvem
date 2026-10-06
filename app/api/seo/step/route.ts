import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { criarGeradorSeo } from "@/lib/seo/generate";
import { gerarSeoPendentes, resumoSeo } from "@/lib/seo/repo";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Gera mais um pedaço das sugestões de SEO com o Claude (a tela repete até `restantes` ser falso). Retomável; não altera a loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { maxProdutos?: unknown; ignorar?: unknown };
  const maxProdutos = Number.isInteger(body.maxProdutos) && (body.maxProdutos as number) > 0 ? Math.min(body.maxProdutos as number, 500) : undefined;
  const ignorar = Array.isArray(body.ignorar) ? body.ignorar.filter((s): s is string => typeof s === "string" && /^\d+$/.test(s)).slice(0, 2000) : [];
  try {
    const db = { query };
    const r = await gerarSeoPendentes(db, { storeId: store.id, budgetMs: 25_000, gerador: criarGeradorSeo(), maxProdutos, ignorar });
    const resumo = await resumoSeo(db, store.id);
    return Response.json({ ...r, geradasTotal: resumo.geradas, produtos: resumo.produtos });
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "seo.generate.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao gerar o SEO." }, { status: 500 });
  }
}
