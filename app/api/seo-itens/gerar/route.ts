import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { NuvemshopError } from "@/lib/nuvemshop";
import { gerarSeoItens } from "@/lib/seo/item";
import { criarGeradorItem } from "@/lib/seo/item-generate";
import { carregarItens } from "@/lib/seo/item-service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Gera o SEO de até 6 categorias ou páginas com o Claude (a tela repete em pedaços). Não altera a loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { tipo?: unknown; ids?: unknown };
  const tipo = body.tipo === "pagina" ? "pagina" : body.tipo === "categoria" ? "categoria" : null;
  const ids = Array.isArray(body.ids) ? body.ids.filter((s): s is string => typeof s === "string" && /^\d{1,15}$/.test(s)).slice(0, 6) : [];
  if (!tipo || ids.length === 0) return Response.json({ error: "Informe o tipo e os itens." }, { status: 400 });
  try {
    const itens = await carregarItens(store, tipo, ids);
    const r = await gerarSeoItens({ query }, { storeId: store.id, tipo, itens, gerador: criarGeradorItem() });
    return Response.json(r);
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "seo.item.generate.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao gerar o SEO." }, { status: 500 });
  }
}
