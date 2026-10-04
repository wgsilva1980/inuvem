"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isAdminEmail } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";

export interface LoginState {
  sent?: boolean;
  error?: string;
}

const emailSchema = z.string().trim().toLowerCase().email();

/**
 * Origem do site que o usuário está usando (a mesma que o SDK envia ao Neon Auth como `Origin`).
 * Não depende de APP_URL: se essa variável estiver errada na Vercel, o endereço de retorno continua certo.
 * O Neon Auth só aceita origens da lista de domínios confiáveis, então um Origin forjado é recusado lá.
 */
async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : null;
}

/**
 * Envia o link de acesso só se o e-mail estiver na allowlist de admins. A resposta ao usuário é a mesma
 * em qualquer caso (não revela quais e-mails têm acesso); o motivo real vai para o log do servidor,
 * sem o e-mail.
 */
export async function sendMagicLink(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Informe um e-mail válido." };

  if (!(await isAdminEmail(parsed.data))) {
    console.log(JSON.stringify({ level: "info", event: "auth.magic_link.skipped", reason: "email_nao_liberado" }));
    return { sent: true };
  }

  const origin = (await requestOrigin()) ?? process.env.APP_URL ?? "";
  const { error } = await auth.signIn.magicLink({ email: parsed.data, callbackURL: `${origin.replace(/\/+$/, "")}/` });
  if (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "auth.magic_link.failed",
        status: error.status,
        code: error.code,
        message: error.message,
        callbackOrigin: origin, // origem (não é segredo): ajuda a ver o que foi enviado ao Neon Auth
      }),
    );
    return { error: "Não foi possível enviar o link agora. Tente novamente em instantes." };
  }
  console.log(JSON.stringify({ level: "info", event: "auth.magic_link.requested" }));
  return { sent: true };
}
