import { getEnv } from "@/lib/env";
import { NuvemshopError } from "@/lib/nuvemshop";
import { isValidCronAuth } from "@/lib/security";
import { NoStoreError, summarize, syncStep } from "@/lib/sync/service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Vercel Cron: envia "Authorization: Bearer $CRON_SECRET". Continua/gera o sync (incremental, ou full na 1ª vez). */
export async function GET(request: Request) {
  const env = getEnv();
  if (!isValidCronAuth(request.headers.get("authorization"), env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const { run, done } = await syncStep("auto", Math.min(env.SYNC_TIME_BUDGET_MS, 45_000));
    return Response.json({ done, run: summarize(run) });
  } catch (err) {
    if (err instanceof NoStoreError) return Response.json({ skipped: err.message });
    const message = err instanceof NuvemshopError ? err.userMessage : "Falha inesperada ao sincronizar.";
    console.error(JSON.stringify({ level: "error", event: "cron.sync_failed", message }));
    return Response.json({ error: message }, { status: 500 });
  }
}
