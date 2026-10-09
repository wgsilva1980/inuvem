import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { codigoValido, loteSchema, payloadDoCupom } from "@/lib/coupons/lote";
import { query } from "@/lib/db";
import { NuvemshopError, createCoupon } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_POR_CHAMADA = 10;
const bodySchema = z.object({ lote: loteSchema, codigos: z.array(z.string()).min(1).max(MAX_POR_CHAMADA) });

/** Cria alguns cupons do lote (a tela repete em pedaços de 10). Cada resultado diz se deu certo; o que falhou pode ser tentado de novo. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const { lote, codigos } = parsed.data;
  if (!codigos.every((c) => codigoValido(c, lote.prefixo))) return Response.json({ error: "Código fora do padrão do lote." }, { status: 400 });

  const client = await clientForStore(store);
  const resultados: Array<{ code: string; ok: boolean; error?: string }> = [];
  for (const code of [...new Set(codigos)]) {
    try {
      await createCoupon(client, payloadDoCupom(lote, code));
      resultados.push({ code, ok: true });
    } catch (err) {
      resultados.push({ code, ok: false, error: err instanceof NuvemshopError ? err.userMessage : "Falha inesperada." });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break; // sem permissão: não adianta insistir
    }
  }
  const criados = resultados.filter((r) => r.ok).map((r) => r.code);
  if (criados.length > 0) {
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'cupom.criar', 'cupom', $3::jsonb, true)`, [
      store.id,
      admin.email,
      JSON.stringify({ prefixo: lote.prefixo, codigos: criados, tipo: lote.tipo, valor: lote.valor, inicio: lote.inicio, fim: lote.fim, usos: lote.usosPorCupom }),
    ]);
  }
  return Response.json({ resultados });
}
