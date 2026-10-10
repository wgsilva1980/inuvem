import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { NuvemshopError, fulfillOrder, getOrder } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { marcarComoEnviados } from "@/lib/shipping/enviar";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  envios: z
    .array(z.object({ orderId: z.number().int().positive(), codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{4,39}$/) }))
    .min(1)
    .max(10),
  notificar: z.boolean(),
});

/** Marca até 10 pedidos como enviados na loja, com o código de rastreio (a tela repete em pedaços). Cada pedido é conferido na loja antes. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos: confira os códigos de rastreio (5 a 40 letras e números)." }, { status: 400 });
  try {
    const client = await clientForStore(store);
    const resultados = await marcarComoEnviados(
      { query },
      { getOrder: (id) => getOrder(client, id), fulfillOrder: (id, a) => fulfillOrder(client, id, a) },
      { storeId: store.id, actor: admin.email, envios: parsed.data.envios, notificar: parsed.data.notificar },
    );
    return Response.json({ resultados });
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "expedicao.enviar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao marcar como enviado." }, { status: 500 });
  }
}
