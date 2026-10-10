import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { definirCustos } from "@/lib/costs/repo";
import { query } from "@/lib/db";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  itens: z
    .array(z.object({ id: z.string().regex(/^\d{1,15}$/), custo: z.number().finite().min(0).max(9_999_999).nullable() }))
    .min(1)
    .max(100),
});

/** Define (ou apaga, com null) o custo de produtos. Fica só no painel: nada é enviado à loja. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos. O custo deve ser um número de 0 em diante." }, { status: 400 });
  const itens = parsed.data.itens.map((i) => ({ productId: i.id, custo: i.custo === null ? null : Math.round(i.custo * 100) / 100 }));
  const r = await definirCustos({ query }, { storeId: store.id, actor: admin.email, origem: "manual", itens });
  await query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'custo.definir', 'produto', $3, $4::jsonb, true)`, [
    store.id,
    admin.email,
    itens.length === 1 ? itens[0]!.productId : null,
    JSON.stringify({ gravados: r.gravados, apagados: r.apagados, ...(itens.length <= 5 ? { itens } : {}) }),
  ]);
  return Response.json(r);
}
