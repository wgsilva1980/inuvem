import { WEBHOOK_EVENTS } from "./handler";

export interface WebhookRegistry {
  list(): Promise<Array<{ id: number; event: string; url: string }>>;
  create(input: { event: string; url: string }): Promise<unknown>;
}

export interface RegisterResult {
  created: string[];
  existing: string[];
  /** Eventos já assinados para OUTRA url (não mexemos neles). */
  otherUrl: string[];
  failed: Array<{ event: string; message: string }>;
}

/** Garante a assinatura dos eventos do painel na Nuvemshop. Idempotente: só cria o que falta. */
export async function ensureWebhooks(
  registry: WebhookRegistry,
  url: string,
  describeError: (err: unknown) => string = (e) => (e instanceof Error ? e.message : String(e)),
): Promise<RegisterResult> {
  const current = await registry.list();
  const result: RegisterResult = { created: [], existing: [], otherUrl: [], failed: [] };
  for (const event of WEBHOOK_EVENTS) {
    const forEvent = current.filter((w) => w.event === event);
    if (forEvent.some((w) => w.url === url)) {
      result.existing.push(event);
      continue;
    }
    if (forEvent.length > 0) result.otherUrl.push(event);
    try {
      await registry.create({ event, url });
      result.created.push(event);
    } catch (err) {
      result.failed.push({ event, message: describeError(err) });
    }
  }
  return result;
}
