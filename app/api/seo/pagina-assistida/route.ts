import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { criarGeradorItem } from "@/lib/seo/item-generate";
import { PaginaPublicaError, TEXTO_MAX, hostsDaLoja, itemDaPagina, lerPaginaPublica, validarEndereco } from "@/lib/seo/pagina-publica";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 40;

/**
 * SEO assistido de uma página institucional: lê a página pública da loja (só do domínio da loja) ou usa o texto colado, pede título e descrição ao
 * Claude e devolve para a pessoa colar no admin da Nuvemshop. Não grava nada em lugar nenhum.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { endereco?: unknown; titulo?: unknown; texto?: unknown };
  if ((await hit({ query }, `seo-pagina:${admin.email}`, 3600)) > LIMITE_POR_HORA) return Response.json({ error: "Muitos pedidos na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    let item;
    if (typeof body.endereco === "string" && body.endereco.trim()) {
      const hosts = await hostsDaLoja({ query }, store.id);
      if (hosts.length === 0) return Response.json({ error: "Não consegui descobrir o endereço público da loja (sincronize os produtos primeiro). Por enquanto, cole o texto da página." }, { status: 409 });
      const pagina = await lerPaginaPublica(validarEndereco(body.endereco, hosts), hosts);
      item = itemDaPagina(pagina);
    } else {
      const titulo = typeof body.titulo === "string" ? body.titulo.replace(/\s+/g, " ").trim() : "";
      const texto = typeof body.texto === "string" ? body.texto.trim() : "";
      if (titulo.length < 2 || titulo.length > 120) return Response.json({ error: "Informe o título da página (2 a 120 caracteres)." }, { status: 400 });
      if (texto.length > TEXTO_MAX * 2) return Response.json({ error: `O texto pode ter no máximo ${TEXTO_MAX * 2} caracteres.` }, { status: 400 });
      item = itemDaPagina({ nome: titulo, texto });
    }
    const s = await criarGeradorItem()("pagina", item);
    return Response.json({ nome: item.nome, tituloAtual: item.seoTituloAtual, descricaoAtual: item.seoDescricaoAtual, titulo: s.titulo, descricao: s.descricao, avisos: s.avisos });
  } catch (err) {
    if (err instanceof PaginaPublicaError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "seo.pagina_assistida.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível gerar o SEO agora. Tente de novo." }, { status: 502 });
  }
}
