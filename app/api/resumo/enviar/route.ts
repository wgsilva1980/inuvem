import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv } from "@/lib/env";
import { query } from "@/lib/db";
import { EmailConfigError, EmailEnvioError } from "@/lib/digest/enviar";
import { enviarResumoDoDia } from "@/lib/digest/service";
import { hit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Envia agora o resumo de hoje aos destinatários salvos (teste). Não conta como o envio automático do dia. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Origem não permitida." }, { status: 403 });
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;
  const store = await getActiveStore();
  if (!store) return Response.json({ error: "Nenhuma loja conectada." }, { status: 409 });
  if ((await hit({ query }, `resumo-teste:${admin.email}`, 3600)) > 10) return Response.json({ error: "Muitos envios de teste na última hora. Tente de novo daqui a pouco." }, { status: 429 });
  try {
    const r = await enviarResumoDoDia({ query }, { storeId: store.id, actor: admin.email, appUrl: getEnv().APP_URL, manual: true });
    return r.enviado ? Response.json(r) : Response.json({ error: r.motivo === "Nenhum destinatário administrador." ? "Salve ao menos um destinatário antes de enviar o teste." : r.motivo }, { status: 409 });
  } catch (err) {
    if (err instanceof EmailConfigError) return Response.json({ error: err.message }, { status: 409 });
    if (err instanceof EmailEnvioError) return Response.json({ error: err.message }, { status: 502 });
    console.error(JSON.stringify({ level: "error", event: "resumo.enviar.failed", message: err instanceof Error ? err.message : String(err) }));
    return Response.json({ error: "Falha inesperada ao enviar o resumo." }, { status: 500 });
  }
}
