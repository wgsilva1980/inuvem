import { AlertaConfigError, enviarAlertaTeste } from "@/lib/alerts/service";
import { requireAdminApi } from "@/lib/auth/admin";
import { query } from "@/lib/db";
import { EmailConfigError, EmailEnvioError } from "@/lib/digest/enviar";
import { getEnv } from "@/lib/env";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Manda um alerta de exemplo aos destinatários salvos (mesmo com os alertas desligados). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  const db = { query };
  if ((await hit(db, `alerta-teste:${admin.email}`, 3600)) > 10) return Response.json({ error: "Muitos envios de teste na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    return Response.json(await enviarAlertaTeste(db, { storeId: store.id, appUrl: getEnv().APP_URL }));
  } catch (err) {
    if (err instanceof AlertaConfigError || err instanceof EmailConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof EmailEnvioError) return Response.json({ error: err.message }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "alertas.teste.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao enviar o teste." }, { status: 500 });
  }
}
