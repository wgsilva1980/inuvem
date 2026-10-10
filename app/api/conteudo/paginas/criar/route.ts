import { requireAdminApi } from "@/lib/auth/admin";
import { PaginaConteudoError, criarPaginaNaLoja } from "@/lib/content/pagina-service";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cria a página revisada na loja (rascunho por padrão). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { titulo?: unknown; html?: unknown; publicar?: unknown };
  if (typeof body.titulo !== "string" || typeof body.html !== "string") return Response.json({ error: "Informe o título e o texto." }, { status: 400 });
  try {
    const r = await criarPaginaNaLoja({ query }, await clientForStore(store), { storeId: store.id, actor: admin.email, titulo: body.titulo, html: body.html, publicar: body.publicar === true });
    return Response.json(r);
  } catch (err) {
    if (err instanceof PaginaConteudoError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "conteudo.pagina.criar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao criar a página." }, { status: 500 });
  }
}
