import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { RevisaoConfigError } from "@/lib/images/review";
import { listarParados } from "@/lib/promotions/parados";
import { criarSugeridor, sugestaoPorRegra } from "@/lib/promotions/sugestao";
import { resumoVendas } from "@/lib/sales/sync";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sugere o desconto de cada produto parado. Os dados dos produtos vêm do banco (nunca do navegador); o Claude ajusta o desconto de partida
 * e explica. Sem a chave da Anthropic, devolve o desconto por regra (`ia: false`).
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; dias?: unknown; minEstoque?: unknown; apenasPublicados?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^\d{1,15}$/.test(x)).slice(0, 100) : [];
  if (ids.length === 0) return Response.json({ error: "Nenhum produto informado." }, { status: 400 });
  const num = (v: unknown, min: number, max: number, padrao: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : padrao);

  const db = { query };
  const resumo = await resumoVendas(db, store.id);
  if (!resumo.janelaDias) return Response.json({ error: "Leia as vendas da loja primeiro." }, { status: 409 });
  const { itens } = await listarParados(db, store.id, {
    dias: num(body.dias, 1, 730, 90),
    minEstoque: num(body.minEstoque, 1, 100000, 1),
    apenasPublicados: body.apenasPublicados !== false,
    janelaDias: resumo.janelaDias,
    limit: 500,
  });
  const escolhidos = itens.filter((p) => ids.includes(p.id));
  try {
    const sugestoes = await criarSugeridor()(escolhidos);
    return Response.json({ ia: true, sugestoes });
  } catch (err) {
    if (err instanceof RevisaoConfigError) return Response.json({ ia: false, aviso: err.message, sugestoes: escolhidos.map(sugestaoPorRegra) });
    console.error(JSON.stringify({ level: "error", event: "liquidar.sugestoes.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ ia: false, aviso: "A IA não respondeu agora; usei a regra por tempo parado.", sugestoes: escolhidos.map(sugestaoPorRegra) });
  }
}
