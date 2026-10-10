import { requireAdminApi } from "@/lib/auth/admin";
import { FATOS_MAX, ehTipoPagina, gerarPagina } from "@/lib/content/pagina-ia";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 30;

/** Escreve o rascunho de uma página institucional a partir dos fatos informados. Não grava nada na loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { tipo?: unknown; fatos?: unknown };
  const fatos = typeof body.fatos === "string" ? body.fatos.trim() : "";
  if (!ehTipoPagina(body.tipo)) return Response.json({ error: "Escolha o tipo de página." }, { status: 400 });
  if (fatos.length > FATOS_MAX) return Response.json({ error: `Os fatos podem ter no máximo ${FATOS_MAX} caracteres.` }, { status: 400 });
  if ((await hit({ query }, `conteudo-pagina:${admin.email}`, 3600)) > LIMITE_POR_HORA) return Response.json({ error: "Muitos rascunhos na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    return Response.json(await gerarPagina({ tipo: body.tipo, fatos }));
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "conteudo.pagina.gerar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível escrever a página agora. Tente de novo." }, { status: 502 });
  }
}
