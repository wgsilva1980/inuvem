import { getEnv } from "@/lib/env";
import { NuvemshopError } from "@/lib/nuvemshop";
import { SemLojaError, passoClientesDaLoja } from "@/lib/customers/service";
import { isValidCronAuth } from "@/lib/security";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron (diário). Primeiro cuida das promoções agendadas (começa as que chegaram na hora, encerra as vencidas; o plano Hobby da Vercel
 * só permite 2 crons, então este também faz esse serviço). Depois sincroniza os clientes alterados desde a última vez. Só roda se os clientes já foram sincronizados uma vez à mão
 * (a primeira carga completa é decisão da pessoa, na tela de Contatos). Continua de onde parou se o tempo acabar.
 */
export async function GET(request: Request) {
  if (!isValidCronAuth(request.headers.get("authorization"), getEnv().CRON_SECRET)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  let promocoes: { processadas: number } | undefined;
  try {
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const { tickPromocoes } = await import("@/lib/promotions/engine");
    const { bulkApiDaLoja } = await import("@/lib/promotions/service");
    const loja = await getActiveStore();
    if (loja) promocoes = await tickPromocoes({ query }, await bulkApiDaLoja(loja), { storeId: loja.id, budgetMs: 20_000 });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cron.promocoes_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  try {
    const { ultimaSincronizacao } = await import("@/lib/customers/sync");
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const store = await getActiveStore();
    if (!store) return Response.json({ skipped: "Nenhuma loja conectada." });
    if (!(await ultimaSincronizacao({ query }, store.id))) return Response.json({ skipped: "Clientes ainda não sincronizados à mão.", promocoes });

    let page: number | undefined;
    let inicio: string | undefined;
    const limite = Date.now() + 30_000;
    let lidos = 0;
    for (;;) {
      const passo = await passoClientesDaLoja({ page, inicio, budgetMs: Math.max(1_000, limite - Date.now()), actor: "cron" });
      lidos += passo.lidos;
      if (passo.concluido) return Response.json({ done: true, lidos, promocoes });
      if (Date.now() >= limite) return Response.json({ done: false, lidos, proxima: passo.proxima, promocoes });
      page = passo.proxima ?? undefined;
      inicio = passo.inicio;
    }
  } catch (err) {
    if (err instanceof SemLojaError) return Response.json({ skipped: err.message });
    const message = err instanceof NuvemshopError ? err.userMessage : "Falha inesperada ao sincronizar os clientes.";
    console.error(JSON.stringify({ level: "error", event: "cron.customers_failed", message }));
    return Response.json({ error: message }, { status: 500 });
  }
}
