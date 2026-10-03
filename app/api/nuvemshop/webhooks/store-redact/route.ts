import { query } from "@/lib/db";
import { logPrivacy, readPrivacyRequest } from "@/lib/nuvemshop/privacy-webhook";
import { redactStore } from "@/lib/privacy";

export const dynamic = "force-dynamic";

/** LGPD store/redact: apaga os dados da loja. Só com assinatura válida (a operação é destrutiva). */
export async function POST(request: Request) {
  const req = await readPrivacyRequest(request);
  if (!req.verified) {
    logPrivacy("privacy.store_redact.rejected", req);
    return Response.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  if (req.storeId === null) return Response.json({ error: "store_id ausente." }, { status: 400 });

  const removed = await redactStore({ query }, req.storeId);
  logPrivacy("privacy.store_redact.done", req, { removed });
  return Response.json({ ok: true });
}
