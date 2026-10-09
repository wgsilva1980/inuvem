import "server-only";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { SIGNATURE_HEADER, verifyWebhookSignature } from "./webhook-verify";

const payloadSchema = z
  .object({
    store_id: z.union([z.number(), z.string()]).transform(Number),
    customer: z.object({ id: z.union([z.number(), z.string()]).transform(Number) }).passthrough().optional(),
  })
  .passthrough();

export interface PrivacyRequest {
  verified: boolean;
  storeId: number | null;
  /** ID do cliente citado no pedido (se houver). */
  customerId: number | null;
  /** O corpo é um pedido de remoção (`customers/redact` traz `orders_to_redact`), não de consulta. */
  redact: boolean;
}

/** Lê o corpo bruto, valida a assinatura e extrai o `store_id`. Nunca lança por corpo inválido. */
export async function readPrivacyRequest(request: Request): Promise<PrivacyRequest> {
  const raw = await request.text();
  const verified = verifyWebhookSignature(raw, request.headers.get(SIGNATURE_HEADER), getEnv().NUVEMSHOP_CLIENT_SECRET);
  let storeId: number | null = null;
  let customerId: number | null = null;
  let redact = false;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(raw));
    if (parsed.success && Number.isInteger(parsed.data.store_id)) {
      storeId = parsed.data.store_id;
      const cid = parsed.data.customer?.id;
      if (cid !== undefined && Number.isInteger(cid) && cid > 0) customerId = cid;
      redact = "orders_to_redact" in parsed.data;
    }
  } catch {
    /* corpo não é JSON */
  }
  return { verified, storeId, customerId, redact };
}

/** Log estruturado sem dados pessoais (só o tipo, a loja e o resultado da verificação). */
export function logPrivacy(event: string, req: PrivacyRequest, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, storeId: req.storeId, verified: req.verified, ...extra }));
}
