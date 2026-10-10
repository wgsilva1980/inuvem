import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { EMAIL_CORPO_MAX, TIPOS_MANUAIS, ehTipoManual } from "@/lib/emails/repo";
import { criarReescritor } from "@/lib/emails/rewrite";
import { reescreverEmail } from "@/lib/emails/service";
import { RevisaoConfigError } from "@/lib/images/review";
import { NuvemshopError, listEmailTemplates } from "@/lib/nuvemshop";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 40;

/** Reescreve com a IA um modelo de e-mail da loja (por `key`) ou um texto colado (`tipo`, `assunto`, `corpo`). Não altera nada na loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; tipo?: unknown; assunto?: unknown; corpo?: unknown };

  let key: string;
  let label: string;
  let assunto: string;
  let corpo: string;
  try {
    if (ehTipoManual(body.tipo)) {
      key = `manual:${body.tipo}`;
      label = TIPOS_MANUAIS[body.tipo];
      assunto = typeof body.assunto === "string" ? body.assunto.trim() : "";
      corpo = typeof body.corpo === "string" ? body.corpo.trim() : "";
      if (!corpo) return Response.json({ error: "Cole o texto do e-mail." }, { status: 400 });
    } else if (typeof body.key === "string" && body.key) {
      const m = (await listEmailTemplates(await clientForStore(store))).items.find((x) => x.id === body.key);
      if (!m) return Response.json({ error: "Esse modelo não está mais na loja. Atualize a página." }, { status: 404 });
      key = m.id;
      label = m.nome;
      assunto = m.assunto;
      corpo = m.corpo;
    } else {
      return Response.json({ error: "Escolha um modelo ou cole um e-mail." }, { status: 400 });
    }
    if (corpo.length > EMAIL_CORPO_MAX || assunto.length > 500) return Response.json({ error: "O e-mail é grande demais." }, { status: 400 });
    if ((await hit({ query }, `email-ia:${admin.email}`, 3600)) > LIMITE_POR_HORA) return Response.json({ error: "Muitas reescritas na última hora. Tente de novo daqui a pouco." }, { status: 429 });
    return Response.json(await reescreverEmail({ query }, { storeId: store.id, actor: admin.email, key, label, assunto, corpo, reescritor: criarReescritor() }));
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "email.gerar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao reescrever o e-mail." }, { status: 500 });
  }
}
