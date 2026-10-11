import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv } from "@/lib/env";
import { NuvemshopError, createWebhook, listWebhooks } from "@/lib/nuvemshop";
import { isSameOrigin } from "@/lib/security";
import { clientForStore, getActiveStore } from "@/lib/stores";
import { ALERT_WEBHOOK_EVENTS } from "@/lib/webhooks/handler";
import { ensureWebhooks } from "@/lib/webhooks/register";

export const dynamic = "force-dynamic";

/** Assina na Nuvemshop o aviso de pedido pago (os de produto já são assinados em Diagnóstico). Idempotente. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const base = getEnv().APP_URL.replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(base)) return Response.json({ error: "APP_URL aponta para localhost: ajuste na Vercel para o endereço público do painel." }, { status: 409 });
  try {
    const client = await clientForStore(store);
    const result = await ensureWebhooks(
      { list: () => listWebhooks(client), create: (input) => createWebhook(client, input) },
      `${base}/api/webhooks/nuvemshop`,
      (err) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err)),
      ALERT_WEBHOOK_EVENTS,
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof NuvemshopError) return Response.json({ error: err.userMessage }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "alertas.webhooks.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao registrar o aviso de pedido pago." }, { status: 500 });
  }
}
