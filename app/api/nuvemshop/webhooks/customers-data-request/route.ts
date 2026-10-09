import { query } from "@/lib/db";
import { redactCustomer } from "@/lib/privacy";
import { logPrivacy, readPrivacyRequest } from "@/lib/nuvemshop/privacy-webhook";

export const dynamic = "force-dynamic";

/**
 * LGPD customers/redact e customers/data_request (o Portal pode apontar os dois para esta URL).
 * O INuvem guarda uma cópia dos clientes da loja (Contatos): no pedido de remoção (assinatura válida e `orders_to_redact`)
 * apaga o cliente e o contato ligado a ele. No pedido de dados só registra (a loja é a fonte e responde por ele).
 * Os logs nunca levam dados pessoais.
 */
export async function POST(request: Request) {
  const req = await readPrivacyRequest(request);
  let removidos = 0;
  if (req.verified && req.redact && req.storeId !== null && req.customerId !== null) {
    try {
      removidos = await redactCustomer({ query }, req.storeId, req.customerId);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "privacy.customers_redact.failed", storeId: req.storeId, message: err instanceof Error ? err.message : String(err) }));
      return Response.json({ error: "Falha ao remover os dados do cliente." }, { status: 500 });
    }
  }
  logPrivacy("privacy.customers_request", req, { redact: req.redact, removidos });
  return Response.json({ ok: true, removidos });
}
