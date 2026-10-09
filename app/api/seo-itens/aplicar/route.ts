import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { aplicarSugestoes } from "@/lib/seo/item";
import { apisDoCliente, carregarItens } from "@/lib/seo/item-service";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Grava na loja as sugestões guardadas de até 8 categorias ou páginas (`modo`: "vazios" ou "todos"). A tela repete em pedaços; cada item vai para o Histórico. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { tipo?: unknown; ids?: unknown; modo?: unknown };
  const tipo = body.tipo === "pagina" ? "pagina" : body.tipo === "categoria" ? "categoria" : null;
  const ids = Array.isArray(body.ids) ? body.ids.filter((s): s is string => typeof s === "string" && /^\d{1,15}$/.test(s)).slice(0, 8) : [];
  if (!tipo || ids.length === 0) return Response.json({ error: "Informe o tipo e os itens." }, { status: 400 });
  try {
    const itens = await carregarItens(store, tipo, ids);
    const atuais = new Map(itens.map((i) => [i.id, { titulo: i.seoTituloAtual, descricao: i.seoDescricaoAtual }]));
    const resultados = await aplicarSugestoes({ query }, apisDoCliente(await clientForStore(store)), {
      storeId: store.id,
      actor: admin.email,
      tipo,
      ids,
      modo: body.modo === "todos" ? "todos" : "vazios",
      atuais,
    });
    return Response.json({ resultados });
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "seo.item.apply.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao gravar o SEO." }, { status: 500 });
  }
}
