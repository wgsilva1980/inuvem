import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { CompraError, cancelarPedidoDeCompra } from "@/lib/purchasing/service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ id: z.string().regex(/^\d{1,15}$/) });

/** Cancela um pedido de compra aberto (não mexe na loja). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  try {
    await cancelarPedidoDeCompra({ query }, { storeId: store.id, actor: admin.email, id: parsed.data.id });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof CompraError) return Response.json({ error: err.message }, { status: 409 });
    console.error(JSON.stringify({ level: "error", event: "compra.cancelar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao cancelar." }, { status: 500 });
  }
}
