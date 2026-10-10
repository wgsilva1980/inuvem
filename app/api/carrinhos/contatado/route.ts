import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/admin";
import { marcarContatado } from "@/lib/carts/service";
import { query } from "@/lib/db";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ id: z.number().int().positive(), contatado: z.boolean() });

/** Marca (ou desmarca) um carrinho como já contatado, para a equipe não falar duas vezes com a mesma cliente. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  await marcarContatado({ query }, { storeId: store.id, actor: admin.email, ...parsed.data });
  return Response.json({ ok: true });
}
