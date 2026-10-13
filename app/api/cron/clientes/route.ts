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
    if (loja) promocoes = await tickPromocoes({ query }, await bulkApiDaLoja(loja), { storeId: loja.id, budgetMs: 15_000 });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cron.promocoes_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  let pedidos: { lidos: number; concluido: boolean } | undefined;
  try {
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const { ultimaSincronizacaoPedidos } = await import("@/lib/orders/sync");
    const { passoPedidosDaLoja } = await import("@/lib/orders/service");
    const loja = await getActiveStore();
    // só depois da primeira leitura feita à mão; então traz os pedidos alterados desde a última vez
    if (loja && (await ultimaSincronizacaoPedidos({ query }, loja.id))) {
      const limitePedidos = Date.now() + 12_000;
      let page: number | undefined;
      let inicio: string | undefined;
      pedidos = { lidos: 0, concluido: false };
      for (;;) {
        const passo = await passoPedidosDaLoja({ page, inicio, budgetMs: Math.max(1_000, limitePedidos - Date.now()), actor: "cron" });
        pedidos.lidos += passo.lidos;
        if (passo.concluido) {
          pedidos.concluido = true;
          break;
        }
        if (Date.now() >= limitePedidos) break;
        page = passo.proxima ?? undefined;
        inicio = passo.inicio;
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cron.pedidos_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  let resumo: { enviado: boolean; motivo?: string } | undefined;
  try {
    // Resumo diário por e-mail: depois dos pedidos lidos, para as vendas de ontem estarem completas. Uma falha aqui não derruba o resto.
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const { enviarResumoDoDia } = await import("@/lib/digest/service");
    const loja = await getActiveStore();
    if (loja) {
      const r = await enviarResumoDoDia({ query }, { storeId: loja.id, actor: "cron", appUrl: getEnv().APP_URL });
      resumo = r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo };
    }
  } catch (err) {
    resumo = { enviado: false, motivo: "falhou" };
    console.error(JSON.stringify({ level: "error", event: "cron.resumo_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  let mensal: { enviado: boolean; motivo?: string } | undefined;
  try {
    // Relatório do mês anterior: nos dias 1 a 3, uma vez por mês, junto do resumo diário. Uma falha aqui não derruba o resto.
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const { enviarRelatorioMensal } = await import("@/lib/digest/mensal");
    const loja = await getActiveStore();
    if (loja) {
      const r = await enviarRelatorioMensal({ query }, { storeId: loja.id, actor: "cron", appUrl: getEnv().APP_URL });
      mensal = r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo };
    }
  } catch (err) {
    mensal = { enviado: false, motivo: "falhou" };
    console.error(JSON.stringify({ level: "error", event: "cron.relatorio_mensal_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  let categorias: { ocultadas: number; exibidas: number } | undefined;
  try {
    // Rede de segurança da regra das categorias vazias (a regra principal roda a cada aviso de produto): só age se a pessoa ligou a opção.
    const { query } = await import("@/lib/db");
    const { clientForStore, getActiveStore } = await import("@/lib/stores");
    const { getCategory, updateCategory } = await import("@/lib/nuvemshop");
    const { aplicarRegraCategorias } = await import("@/lib/automations/categorias");
    const loja = await getActiveStore();
    if (loja) {
      const client = await clientForStore(loja);
      const r = await aplicarRegraCategorias({ query }, { getCategory: (id) => getCategory(client, id), setVisibility: (id, visibility) => updateCategory(client, id, { visibility }) }, { storeId: loja.id });
      if (!r.desligada) categorias = { ocultadas: r.ocultadas, exibidas: r.exibidas };
      // rede de segurança do arquivo de menu (FTP): reenvia se o conteúdo mudou desde o último envio
      const { atualizarMenuSeLigado } = await import("@/lib/menu/service");
      await atualizarMenuSeLigado({ query }, loja.id, "cron");
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cron.categorias_vazias_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  let vigia: { problemas: number } | undefined;
  try {
    // Vigia das integrações: confere conexão, avisos da Nuvemshop e rotinas diárias; avisa por e-mail quando algo passa a ter problema.
    const { query } = await import("@/lib/db");
    const { clientForStore, getActiveStore } = await import("@/lib/stores");
    const { listWebhooks } = await import("@/lib/nuvemshop");
    const { rodarVigia } = await import("@/lib/vigia/service");
    const loja = await getActiveStore();
    if (loja) {
      const client = await clientForStore(loja);
      const itens = await rodarVigia({ query }, { storeId: loja.id, scope: loja.scope, appUrl: getEnv().APP_URL, listarWebhooks: () => listWebhooks(client) });
      vigia = { problemas: itens.filter((i) => i.status === "erro").length };
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "cron.vigia_failed", message: err instanceof Error ? err.message : String(err) }));
  }
  try {
    const { ultimaSincronizacao } = await import("@/lib/customers/sync");
    const { query } = await import("@/lib/db");
    const { getActiveStore } = await import("@/lib/stores");
    const store = await getActiveStore();
    if (!store) return Response.json({ skipped: "Nenhuma loja conectada." });
    if (!(await ultimaSincronizacao({ query }, store.id))) return Response.json({ skipped: "Clientes ainda não sincronizados à mão.", promocoes, pedidos, resumo, mensal, vigia, categorias });

    let page: number | undefined;
    let inicio: string | undefined;
    const limite = Date.now() + 25_000;
    let lidos = 0;
    for (;;) {
      const passo = await passoClientesDaLoja({ page, inicio, budgetMs: Math.max(1_000, limite - Date.now()), actor: "cron" });
      lidos += passo.lidos;
      if (passo.concluido) return Response.json({ done: true, lidos, promocoes, pedidos, resumo, mensal, vigia, categorias });
      if (Date.now() >= limite) return Response.json({ done: false, lidos, proxima: passo.proxima, promocoes, pedidos, resumo, mensal, vigia, categorias });
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
