import { query } from "@/lib/db";
import { getAuth } from "@/lib/auth/server";
import { checkMagicLinkLimits, checkOtpVerifyLimit, clientIp } from "@/lib/rate-limit";

type Handlers = ReturnType<ReturnType<typeof getAuth>["handler"]>;

let handlers: Handlers | undefined;
const resolve = (): Handlers => (handlers ??= getAuth().handler());

export const GET: Handlers["GET"] = (...args) => resolve().GET(...args);

const endsWith = (request: Request, suffix: string) => new URL(request.url).pathname.endsWith(suffix);

export const POST: Handlers["POST"] = async (...args) => {
  const [request] = args;
  // Pedir link ou código de acesso é público e dispara e-mail; entrar com o código é público e é adivinhável: limita por IP (e o envio também no total).
  const sends = endsWith(request, "/sign-in/magic-link") || endsWith(request, "/email-otp/send-verification-otp");
  const verifies = endsWith(request, "/sign-in/email-otp");
  if (sends || verifies) {
    try {
      const ip = clientIp(request);
      const limit = sends ? await checkMagicLinkLimits({ query }, ip) : await checkOtpVerifyLimit({ query }, ip);
      if (!limit.ok) {
        console.warn(JSON.stringify({ level: "warn", event: sends ? "auth.send.rate_limited" : "auth.otp_verify.rate_limited" }));
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
