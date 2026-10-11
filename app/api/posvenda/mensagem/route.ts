import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { PosVendaErro, mensagemDoPedido } from "@/lib/postsale/service";
import { ehTipo } from "@/lib/postsale/rules";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.string().regex(/^\d{1,15}$/), tipo: z.string().refine(ehTipo) });

/** Texto pronto (e links de WhatsApp/e-mail) para o pós-venda de um pedido. Nada é enviado; o contato vem do espelho de clientes. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  try {
    return Response.json(await mensagemDoPedido({ query }, { storeId: store.id, orderId: parsed.data.orderId, tipo: parsed.data.tipo as "tudo-certo" | "avaliacao" }));
  } catch (err) {
    if (err instanceof PosVendaErro) return Response.json({ error: err.message }, { status: 404 });
    console.error(JSON.stringify({ level: "error", event: "posvenda.mensagem.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
