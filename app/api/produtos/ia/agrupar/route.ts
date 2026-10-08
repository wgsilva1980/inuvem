import { requireAdminApi } from "@/lib/auth/admin";
import { sniffImageType } from "@/lib/catalog/images";
import { criarAgrupador } from "@/lib/catalog/ai-group";
import { MAX_FOTOS_LOTE } from "@/lib/catalog/ai-draft-shared";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE_POR_HORA = 20;
const MAX_MINIATURA_BYTES = 400_000;

/** Cadastro em lote: recebe miniaturas (512 px) de várias peças misturadas e devolve os grupos de fotos por peça. Não grava nada. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Falta configurar a chave da API da Anthropic (variável ANTHROPIC_API_KEY na Vercel) e fazer um novo deploy." }, { status: 409 });
  }

  const form = await request.formData().catch(() => null);
  const arquivos = (form?.getAll("fotos") ?? []).filter((f): f is File => f instanceof File);
  if (arquivos.length === 0) return Response.json({ error: "Escolha ao menos uma foto." }, { status: 400 });
  if (arquivos.length > MAX_FOTOS_LOTE) return Response.json({ error: `Use no máximo ${MAX_FOTOS_LOTE} fotos de cada vez.` }, { status: 400 });

  const fotos: Array<{ bytes: Buffer; mediaType: "image/jpeg" }> = [];
  for (const arq of arquivos) {
    if (arq.size <= 0 || arq.size > MAX_MINIATURA_BYTES) return Response.json({ error: "Uma das miniaturas é grande demais. Tente de novo." }, { status: 400 });
    const bytes = Buffer.from(await arq.arrayBuffer());
    if (sniffImageType(bytes) !== "image/jpeg") return Response.json({ error: "As miniaturas devem ser JPEG." }, { status: 400 });
    fotos.push({ bytes, mediaType: "image/jpeg" });
  }

  if ((await hit({ query }, `ia-agrupar:${admin.email}`, 3600)) > LIMITE_POR_HORA) {
    return Response.json({ error: "Muitos agrupamentos na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  }

  try {
    return Response.json(await criarAgrupador()(fotos));
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "product.ai_group.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível agrupar as fotos agora. Tente de novo." }, { status: 502 });
  }
}
