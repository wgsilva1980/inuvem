import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv } from "@/lib/env";
import { NuvemshopError, createWebhook, listWebhooks } from "@/lib/nuvemshop";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { ensureWebhooks } from "@/lib/webhooks/register";

export const dynamic = "force-dynamic";

/** Registra (ou confere) os webhooks de produtos e categorias na Nuvemshop. Só para admin logado. */
export async function POST() {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });

  const base = getEnv().APP_URL.replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)) {
    return Response.json({ error: "APP_URL aponta para localhost: ajuste na Vercel para o endereço público do painel." }, { status: 409 });
  }

  try {
    const client = await clientForStore(store);
    const result = await ensureWebhooks(
      { list: () => listWebhooks(client), create: (input) => createWebhook(client, input) },
      `${base}/api/webhooks/nuvemshop`,
      (err) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err)),
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "webhooks.register.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao registrar os webhooks." }, { status: 500 });
  }
}
