import { requireAdminApi } from "@/lib/auth/admin";
import { sugestoesPorCategoria } from "@/lib/catalog/store-context";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** O que a loja costuma fazer nas categorias escolhidas (preço, tamanhos, peso): referência para o cadastro, calculada do espelho. */
export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const ids = (new URL(request.url).searchParams.get("categorias") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 10);
  return Response.json(await sugestoesPorCategoria({ query }, store.id, ids), { headers: { "cache-control": "no-store" } });
}
