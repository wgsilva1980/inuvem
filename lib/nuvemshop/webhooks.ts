import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { webhookSchema } from "./types";

export const listWebhooks = async (c: NuvemshopClient) => z.array(webhookSchema).parse(await c.get("/webhooks"));
export const createWebhook = async (c: NuvemshopClient, input: { event: string; url: string }) =>
  webhookSchema.parse(await c.post("/webhooks", input));
export const deleteWebhook = (c: NuvemshopClient, id: number) => c.delete(`/webhooks/${id}`);
