import { logPrivacy, readPrivacyRequest } from "@/lib/nuvemshop/privacy-webhook";

export const dynamic = "force-dynamic";

/**
 * LGPD customers/redact e customers/data_request. O INuvem administra produtos e NÃO guarda dados
 * de clientes finais, então não há o que apagar ou exportar: responde 200 (registrando o pedido).
 * Atende os dois eventos, pois o Portal pode apontar ambos para esta URL.
 */
export async function POST(request: Request) {
  const req = await readPrivacyRequest(request);
  logPrivacy("privacy.customers_request", req, { note: "sem dados de clientes armazenados" });
  return Response.json({ ok: true, message: "Nenhum dado de cliente é armazenado por este app." });
}
