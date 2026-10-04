import { cookies } from "next/headers";
import { requireAdminApi } from "@/lib/auth/admin";
import { getEnv, userAgent } from "@/lib/env";
import { NuvemshopError, exchangeCode } from "@/lib/nuvemshop";
import { mayConnectStore, safeEqual } from "@/lib/security";
import { getActiveStore, saveStore } from "@/lib/stores";

/** Volta ao painel na mesma origem em que a requisição chegou (não depende de APP_URL). */
function back(request: Request, path: string): Response {
  return Response.redirect(new URL(path, new URL(request.url).origin), 302);
}

/** Recebe o `code` do OAuth, troca por token e guarda (criptografado) no banco. */
export async function GET(request: Request) {
  // Só um admin logado pode conectar a loja (protege contra callbacks forjados).
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return back(request, "/?erro=codigo-ausente");

  // `state` é validado quando presente (fluxo iniciado pelo painel). Instalações iniciadas
  // pelo painel da Nuvemshop não o enviam; nesse caso vale a sessão de admin acima.
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get("ns_state")?.value;
  if (state && (!expected || !safeEqual(state, expected))) return back(request, "/?erro=estado-invalido");

  try {
    const env = getEnv();
    const token = await exchangeCode({
      clientId: env.NUVEMSHOP_CLIENT_ID,
      clientSecret: env.NUVEMSHOP_CLIENT_SECRET,
      code,
      userAgent: userAgent(env),
    });
    // Painel de uma loja só: um callback forjado não pode trocar a loja já conectada por outra.
    const existing = await getActiveStore();
    if (!mayConnectStore(existing?.nuvemshop_store_id, token.user_id)) {
      console.error(JSON.stringify({ level: "warn", event: "nuvemshop.oauth_other_store_rejected" }));
      return back(request, "/?erro=loja-diferente");
    }
    await saveStore({ nuvemshopStoreId: token.user_id, accessToken: token.access_token, scope: token.scope });
    (await cookies()).delete("ns_state");
    return back(request, "/?conectado=1");
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "nuvemshop.oauth_failed", status: err instanceof NuvemshopError ? err.status : undefined }));
    return back(request, "/?erro=falha-oauth");
  }
}
