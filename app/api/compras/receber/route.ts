import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NuvemshopError, getVariant, updateVariant as apiUpdateVariant } from "@/lib/nuvemshop";
import { CompraError, receberPedidoDeCompra } from "@/lib/purchasing/service";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ id: z.string().regex(/^\d{1,15}$/), somarEstoque: z.boolean() });

/** Recebe o pedido: soma as quantidades ao estoque da loja (se pedido) e fecha. Pode vir "parcial": chame de novo para continuar ou tentar as linhas que falharam. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  try {
    const client = await clientForStore(store);
    const r = await receberPedidoDeCompra(
      { query },
      { get: (pid, vid) => getVariant(client, pid, vid), put: (pid, vid, input) => apiUpdateVariant(client, pid, vid, input) },
      { storeId: store.id, actor: admin.email, id: parsed.data.id, somarEstoque: parsed.data.somarEstoque },
    );
    return Response.json(r);
  } catch (err) {
    if (err instanceof CompraError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "compra.receber.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao receber o pedido." }, { status: 500 });
  }
}
