import { requireAdminApi } from "@/lib/auth/admin";
import { sniffImageType } from "@/lib/catalog/images";
import { MAX_FOTOS_IA, criarGeradorRascunho, type RascunhoAtual } from "@/lib/catalog/ai-draft";
import { listCategoryOptions } from "@/lib/catalog/query";
import { query } from "@/lib/db";
import { RevisaoConfigError, prepararFoto } from "@/lib/images/review";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Quantas análises por hora (cada uma custa alguns centavos na API). */
const LIMITE_POR_HORA = 40;
/** Miniaturas que o navegador manda (já reduzidas); o limite protege a memória e o corpo da requisição (4,5 MB na Vercel). */
const MAX_MINIATURA_BYTES = 1_200_000;

/**
 * Cadastro pela foto: recebe as miniaturas da peça (e as anotações) e devolve o rascunho do cadastro feito pelo Claude.
 * Não cria nada na loja nem grava nada: quem confirma é a pessoa, no formulário.
 */
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
  if (!form) return Response.json({ error: "Requisição inválida." }, { status: 400 });
  const arquivos = form.getAll("fotos").filter((f): f is File => f instanceof File);
  if (arquivos.length === 0) return Response.json({ error: "Escolha ao menos uma foto." }, { status: 400 });
  if (arquivos.length > MAX_FOTOS_IA) return Response.json({ error: `Use no máximo ${MAX_FOTOS_IA} fotos de cada vez.` }, { status: 400 });

  const anotacoes = String(form.get("anotacoes") ?? "").slice(0, 3000);
  const ajuste = String(form.get("ajuste") ?? "").slice(0, 500);
  let atual: RascunhoAtual | undefined;
  try {
    const bruto = JSON.parse(String(form.get("atual") ?? "null")) as Record<string, unknown> | null;
    if (bruto && typeof bruto === "object") {
      const t = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
      atual = { nome: t(bruto.nome, 300), descricao: t(bruto.descricao, 3000), tags: t(bruto.tags, 500), seoTitulo: t(bruto.seoTitulo, 200), seoDescricao: t(bruto.seoDescricao, 500) };
    }
  } catch {
    atual = undefined;
  }

  const fotos: Array<{ bytes: Buffer; mediaType: "image/jpeg" }> = [];
  for (const arq of arquivos) {
    if (arq.size <= 0 || arq.size > MAX_MINIATURA_BYTES) return Response.json({ error: "Uma das fotos é grande demais para a análise. Tente de novo." }, { status: 400 });
    const bytes = Buffer.from(await arq.arrayBuffer());
    const tipo = sniffImageType(bytes);
    if (!tipo || tipo === "image/gif") return Response.json({ error: "Use fotos JPEG, PNG ou WEBP." }, { status: 400 });
    try {
      fotos.push(await prepararFoto(bytes));
    } catch {
      return Response.json({ error: "Não foi possível ler uma das fotos." }, { status: 400 });
    }
  }

  if ((await hit({ query }, `ia-cadastro:${admin.email}`, 3600)) > LIMITE_POR_HORA) {
    return Response.json({ error: "Muitas análises na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  }

  try {
    const categorias = (await listCategoryOptions({ query }, store.id)).map((c) => ({ id: c.id, name: c.name }));
    const rascunho = await criarGeradorRascunho()({ fotos, anotacoes, categorias, ajuste: ajuste || undefined, atual });
    return Response.json(rascunho);
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "product.ai_draft.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível analisar as fotos agora. Tente de novo." }, { status: 502 });
  }
}
