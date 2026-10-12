import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { MAX_Q, buscar } from "@/lib/search/busca";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Busca global do painel (Ctrl+K): produtos, pedidos, clientes e categorias, só do que já está no banco. Até 120 buscas por minuto. */
export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ produtos: [], pedidos: [], clientes: [], categorias: [] });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, MAX_Q * 2);
  if ((await hit({ query }, `busca:${admin.email}`, 60)) > 120) return Response.json({ error: "Muitas buscas seguidas. Espere um instante." }, { status: 429 });
  try {
    return Response.json(await buscar({ query }, store.id, q), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "busca.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível buscar agora." }, { status: 500 });
  }
}
