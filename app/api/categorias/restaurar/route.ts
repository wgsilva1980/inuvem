import { requireAdminApi } from "@/lib/auth/admin";
import { restaurarCategorias } from "@/lib/categories/restore";
import { query } from "@/lib/db";
import { NuvemshopError, updateCategory } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Restaura na loja as categorias guardadas em `category_restore` (nome, endereço, descrição e pai originais). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  try {
    const client = await clientForStore(store);
    return Response.json(await restaurarCategorias({ query }, { update: (id, input) => updateCategory(client, id, input) }, { storeId: store.id, actor: admin.email }));
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "categorias.restaurar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao restaurar." }, { status: 500 });
  }
}
