import { getEnv } from "@/lib/env";
import { NuvemshopError } from "@/lib/nuvemshop";
import { avisarSyncFalhou } from "@/lib/alerts/service";
import { query } from "@/lib/db";
import { isValidCronAuth } from "@/lib/security";
import { getActiveStore } from "@/lib/stores";
import { NoStoreError, summarize, syncStep } from "@/lib/sync/service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Avisa por e-mail (se os alertas estiverem ligados) que a sincronização falhou. Nunca lança. */
async function alertar(mensagem: string) {
  try {
    const store = await getActiveStore();
    if (store) await avisarSyncFalhou({ query }, store.id, mensagem, { appUrl: getEnv().APP_URL });
  } catch {
    /* o alerta é um extra: a resposta do cron não depende dele */
  }
}

/** Vercel Cron: envia "Authorization: Bearer $CRON_SECRET". Continua/gera o sync (incremental, ou full na 1ª vez). */
export async function GET(request: Request) {
  const env = getEnv();
  if (!isValidCronAuth(request.headers.get("authorization"), env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { run, done } = await syncStep("auto", Math.min(env.SYNC_TIME_BUDGET_MS, 45_000));
    if (run.status === "failed") await alertar(`a leitura terminou com erro${run.erros.length > 0 ? `: ${JSON.stringify(run.erros.at(-1)).slice(0, 200)}` : ""}`);
    return Response.json({ done, run: summarize(run) });
  } catch (err) {
    if (err instanceof NoStoreError) return Response.json({ skipped: err.message });
    const message = err instanceof NuvemshopError ? err.userMessage : "Falha inesperada ao sincronizar.";
    console.error(JSON.stringify({ level: "error", event: "cron.sync_failed", message }));
    await alertar(message);
    return Response.json({ error: message }, { status: 500 });
  }
}
