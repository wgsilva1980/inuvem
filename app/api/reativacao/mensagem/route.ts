import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { ClienteNaoEncontradaError, mensagemParaCliente } from "@/lib/reactivation/service";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ customerId: z.string().regex(/^\d{1,15}$/) });

/** Texto pronto (e links de WhatsApp/e-mail) para uma cliente. Nada é enviado; o contato vem do espelho de clientes. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Cliente inválida." }, { status: 400 });
  try {
    return Response.json(await mensagemParaCliente({ query }, { storeId: store.id, customerId: parsed.data.customerId }));
  } catch (err) {
    if (err instanceof ClienteNaoEncontradaError) return Response.json({ error: err.message }, { status: 404 });
    console.error(JSON.stringify({ level: "error", event: "reativacao.mensagem.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada." }, { status: 500 });
  }
}
