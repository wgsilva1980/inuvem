import { z } from "zod";
import { NuvemshopError, extractApiMessage } from "./errors";

export const TOKEN_URL = "https://www.nuvemshop.com.br/apps/authorize/token";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  scope: z.string().optional().default(""),
  user_id: z.union([z.number(), z.string()]).transform((v) => Number(v)),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** URL para onde o lojista é enviado para autorizar o app. */
export function authorizeUrl(appId: string, state?: string): string {
  const url = new URL(`https://www.nuvemshop.com.br/apps/${encodeURIComponent(appId)}/authorize`);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(
  params: { clientId: string; clientSecret: string; code: string; userAgent: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": params.userAgent },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "authorization_code",
      code: params.code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new NuvemshopError("Falha ao trocar o código OAuth", res.status, body, extractApiMessage(body));
  return tokenResponseSchema.parse(body);
}
