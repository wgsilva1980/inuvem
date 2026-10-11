import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv } from "@/lib/env";
import { query } from "@/lib/db";
import { listWebhooks } from "@/lib/nuvemshop";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { rodarVigia } from "@/lib/vigia/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Roda o vigia das integrações agora. Só lê (uma chamada à Nuvemshop para listar os avisos); se um item passar a ter problema, os alertas ligados avisam por e-mail. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if ((await hit({ query }, `vigia:${admin.email}`, 3600)) > 30) return Response.json({ error: "Muitas verificações na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const client = await clientForStore(store);
    const itens = await rodarVigia({ query }, { storeId: store.id, scope: store.scope, appUrl: getEnv().APP_URL, listarWebhooks: () => listWebhooks(client) });
    return Response.json({ itens });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "vigia.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Não foi possível verificar agora." }, { status: 500 });
  }
}
