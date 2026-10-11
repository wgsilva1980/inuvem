import { requireAdminApi } from "@/lib/auth/admin";
import { CorrecaoErro, criarGeradores, ehCampo, sugerirCorrecao } from "@/lib/catalog/corrigir";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { ProductNotFoundError } from "@/lib/catalog/update";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 300;

/** Escreve com a IA os campos pedidos de UM produto (a tela chama um por vez). Não grava nada na loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { produtoId?: unknown; campos?: unknown };
  if (typeof body.produtoId !== "string" || !/^\d+$/.test(body.produtoId)) return Response.json({ error: "Produto inválido." }, { status: 400 });
  const campos = Array.isArray(body.campos) ? body.campos.filter(ehCampo) : [];
  if (campos.length === 0) return Response.json({ error: "Escolha o que corrigir." }, { status: 400 });
  const db = { query };
  if ((await hit(db, `qualidade-sugerir:${admin.email}`, 3600)) > LIMITE_POR_HORA) return Response.json({ error: "Muitas sugestões na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const { textos, seo } = criarGeradores();
    return Response.json(await sugerirCorrecao(db, { storeId: store.id, produtoId: Number(body.produtoId), campos, textos, seo }));
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof ProductNotFoundError || err instanceof CorrecaoErro) return Response.json({ error: err.message }, { status: 404 });
    console.error(JSON.stringify({ level: "error", event: "qualidade.sugerir.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível escrever este produto agora." }, { status: 502 });
  }
}
