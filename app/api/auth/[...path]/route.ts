import { query } from "@/lib/db";
import { getAuth } from "@/lib/auth/server";
import { checkMagicLinkLimits, clientIp } from "@/lib/rate-limit";

type Handlers = ReturnType<ReturnType<typeof getAuth>["handler"]>;

let handlers: Handlers | undefined;
const resolve = (): Handlers => (handlers ??= getAuth().handler());

export const GET: Handlers["GET"] = (...args) => resolve().GET(...args);

export const POST: Handlers["POST"] = async (...args) => {
  const [request] = args;
  // O pedido de link de acesso é público e dispara e-mail: limita por IP e no total.
  if (new URL(request.url).pathname.endsWith("/sign-in/magic-link")) {
    try {
      const limit = await checkMagicLinkLimits({ query }, clientIp(request));
      if (!limit.ok) {
        console.warn(JSON.stringify({ level: "warn", event: "auth.magic_link.rate_limited" }));
        return Response.json(
          { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde alguns minutos." },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds ?? 900) } },
        );
      }
    } catch (err) {
      // Se o contador falhar, não trancamos o login por causa disso (a falha fica no log).
      console.error(JSON.stringify({ level: "error", event: "auth.rate_limit.failed", message: err instanceof Error ? err.message : String(err) }));
    }
  }
  return resolve().POST(...args);
};
