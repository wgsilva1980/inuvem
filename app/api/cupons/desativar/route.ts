import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NuvemshopError, updateCoupon } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ cupons: z.array(z.object({ id: z.number().int().positive(), code: z.string().max(60) })).min(1).max(20) });

/** Desativa cupons (`valid: false`); não apaga, então dá para reativar na loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });

  const client = await clientForStore(store);
  const resultados: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const { id } of parsed.data.cupons) {
    try {
      await updateCoupon(client, id, { valid: false });
      resultados.push({ id, ok: true });
    } catch (err) {
      resultados.push({ id, ok: false, error: err instanceof NuvemshopError ? err.userMessage : "Falha inesperada." });
      if (err instanceof NuvemshopError && (err.status === 401 || err.status === 403)) break;
    }
  }
  const ok = new Set(resultados.filter((r) => r.ok).map((r) => r.id));
  if (ok.size > 0) {
    await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, depois, sucesso) VALUES ($1::uuid, $2, 'cupom.desativar', 'cupom', $3::jsonb, true)`, [
      store.id,
      admin.email,
      JSON.stringify({ codigos: parsed.data.cupons.filter((c) => ok.has(c.id)).map((c) => c.code) }),
    ]);
  }
  return Response.json({ resultados });
}
