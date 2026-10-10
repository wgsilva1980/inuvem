import { requireAdminApi } from "@/lib/auth/admin";
import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { query } from "@/lib/db";
import { CompraError, criarPedidoDeCompra } from "@/lib/purchasing/service";
import { validarPedido } from "@/lib/purchasing/rules";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Cria um pedido de compra (não mexe na loja; só passa a descontar o que está a caminho das sugestões). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if ((await hit({ query }, `compra-criar:${admin.email}`, 3600)) > 60) return Response.json({ error: "Muitos pedidos criados na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  const v = validarPedido((await request.json().catch(() => ({}))) as Record<string, unknown>, hojeEmBrasilia());
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const p = await criarPedidoDeCompra({ query }, { storeId: store.id, actor: admin.email, pedido: v.value });
    return Response.json({ id: p.id, itens: p.itens.length, total: p.total });
  } catch (err) {
    if (err instanceof CompraError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "compra.criar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível criar o pedido agora." }, { status: 500 });
  }
}
