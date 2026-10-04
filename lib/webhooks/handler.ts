import { createHash } from "node:crypto";
import { z } from "zod";
import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Category, Product } from "@/lib/nuvemshop/types";
import { verifyWebhookSignature } from "@/lib/nuvemshop/webhook-verify";
import { removeCategoryFromMirror, upsertCategories, upsertProducts, type Db } from "@/lib/sync/repo";

/** Eventos que o painel assina na Nuvemshop (produtos e categorias). */
export const WEBHOOK_EVENTS = [
  "product/created",
  "product/updated",
  "product/deleted",
  "category/created",
  "category/updated",
  "category/deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Corpo dos webhooks de recurso: só identifica o que mudou ({ store_id, event, id }). */
const payloadSchema = z
  .object({
    store_id: z.union([z.number(), z.string()]).transform(Number),
    event: z.string(),
    id: z.union([z.number(), z.string()]).transform(Number),
  })
  .passthrough();

/** Busca na API da Nuvemshop o estado atual do recurso (injetado para testar sem rede). */
export interface ResourceApi {
  getProduct(id: number): Promise<Product>;
  getCategory(id: number): Promise<Category>;
}

export interface StoreRef {
  id: string;
  nuvemshop_store_id: string;
}

export interface WebhookDeps {
  db: Db;
  clientSecret: string;
  /** Loja do espelho pelo id da Nuvemshop; null se não for uma loja conectada. */
  findStore(nuvemshopStoreId: number): Promise<StoreRef | null>;
  apiFor(store: StoreRef): Promise<ResourceApi>;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Janela de deduplicação. O corpo do webhook não traz hora nem número de entrega: duas atualizações
 * reais do mesmo produto geram corpos idênticos. Por isso só descartamos repetições dentro de poucos
 * segundos (reenvios em rajada); qualquer evento posterior é processado de novo. Processar é sempre
 * seguro de repetir (busca o estado atual e regrava), então a deduplicação só evita trabalho em dobro.
 */
export const DEDUPE_WINDOW_MS = 3000;

export function eventKey(rawBody: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / DEDUPE_WINDOW_MS);
  return createHash("sha256").update(rawBody).update(`|${bucket}`).digest("hex");
}

const isNotFound = (err: unknown) => err instanceof NuvemshopError && err.status === 404;

async function removeProduct(db: Db, storeId: string, id: number) {
  await db.query("DELETE FROM products WHERE store_id = $1::uuid AND id = $2::bigint", [storeId, id]);
}

async function applyEvent(deps: WebhookDeps, store: StoreRef, event: WebhookEvent, id: number) {
  const { db } = deps;
  const storeId = store.id;
  switch (event) {
    case "product/deleted":
      return removeProduct(db, storeId, id);
    case "category/deleted":
      return removeCategoryFromMirror(db, storeId, id);
    case "product/created":
    case "product/updated": {
      const api = await deps.apiFor(store);
      try {
        await upsertProducts(db, storeId, [await api.getProduct(id)]);
      } catch (err) {
        if (isNotFound(err)) return removeProduct(db, storeId, id); // apagado logo depois do evento
        throw err;
      }
      return;
    }
    case "category/created":
    case "category/updated": {
      const api = await deps.apiFor(store);
      try {
        await upsertCategories(db, storeId, [await api.getCategory(id)]);
      } catch (err) {
        if (isNotFound(err)) return removeCategoryFromMirror(db, storeId, id);
        throw err;
      }
      return;
    }
  }
}

const isKnownEvent = (e: string): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e);

/**
 * Trata uma entrega de webhook de produto/categoria. Resposta:
 * 401 assinatura inválida · 400 corpo inválido · 200 processado, repetido ou ignorado ·
 * 500 falha ao processar (a Nuvemshop reenvia; o registro de deduplicação é desfeito para o reenvio valer).
 */
export async function handleWebhook(deps: WebhookDeps, rawBody: string, signature: string | null): Promise<WebhookResult> {
  const log = deps.log ?? ((e) => console.log(JSON.stringify({ level: "info", ...e })));
  if (!verifyWebhookSignature(rawBody, signature, deps.clientSecret)) {
    log({ event: "webhook.rejected", reason: "assinatura_invalida", hasSignature: signature !== null });
    return { status: 401, body: { error: "Assinatura inválida." } };
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success || !Number.isInteger(parsed.data.store_id) || !Number.isInteger(parsed.data.id)) throw new Error("payload");
    payload = parsed.data;
  } catch {
    return { status: 400, body: { error: "Corpo inválido." } };
  }

  if (!isKnownEvent(payload.event)) {
    log({ event: "webhook.ignored", reason: "evento_nao_tratado", webhook: payload.event });
    return { status: 200, body: { ignored: true } };
  }
  const store = await deps.findStore(payload.store_id);
  if (!store) {
    log({ event: "webhook.ignored", reason: "loja_desconhecida", webhook: payload.event });
    return { status: 200, body: { ignored: true } };
  }

  const key = eventKey(rawBody, (deps.now ?? Date.now)());
  const inserted = await deps.db.query<{ event_key: string }>(
    "INSERT INTO webhook_events (store_id, event_key, event) VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING RETURNING event_key",
    [store.id, key, payload.event],
  );
  if (inserted.length === 0) {
    log({ event: "webhook.duplicate", webhook: payload.event });
    return { status: 200, body: { duplicate: true } };
  }

  try {
    await applyEvent(deps, store, payload.event, payload.id);
  } catch (err) {
    await deps.db.query("DELETE FROM webhook_events WHERE store_id = $1::uuid AND event_key = $2", [store.id, key]);
    log({ event: "webhook.failed", webhook: payload.event, message: err instanceof Error ? err.message : String(err) });
    return { status: 500, body: { error: "Falha ao processar." } };
  }

  // Limpeza oportunista: o registro só serve para deduplicar, não precisa ficar.
  await deps.db.query("DELETE FROM webhook_events WHERE store_id = $1::uuid AND received_at < now() - interval '7 days'", [store.id]);
  log({ event: "webhook.processed", webhook: payload.event });
  return { status: 200, body: { ok: true } };
}
