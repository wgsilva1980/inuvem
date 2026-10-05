import { requireAdminApi } from "@/lib/auth/admin";
import { isSameOrigin } from "@/lib/security";
import { query } from "@/lib/db";
import { contarPendentes, medirPendentes } from "@/lib/images/audit";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mede mais um pedaço das imagens (a tela chama de novo até `restantes` ser falso). Retomável: as medidas ficam no banco. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { todas?: unknown };
  try {
    const db = { query };
    const { restantes } = await medirPendentes(db, { storeId: store.id, budgetMs: 25_000, todas: body.todas === true });
    return Response.json({ restantes, ...(await contarPendentes(db, store.id)) });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "image.audit.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao analisar as imagens." }, { status: 500 });
  }
}
