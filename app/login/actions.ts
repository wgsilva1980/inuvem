"use server";

import { z } from "zod";
import { isAdminEmail } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";

export interface LoginState {
  sent?: boolean;
  error?: string;
}

const emailSchema = z.string().trim().toLowerCase().email();

/** URL absoluta de retorno: a chamada parte do servidor, sem Origin do navegador, então "/" ficaria ambíguo. */
function callbackUrl(): string {
  const base = process.env.APP_URL;
  try {
    return base ? new URL("/", base).toString() : "/";
  } catch {
    return "/";
  }
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

  const { error } = await auth.signIn.magicLink({ email: parsed.data, callbackURL: callbackUrl() });
  if (error) {
    console.error(
      JSON.stringify({ level: "error", event: "auth.magic_link.failed", status: error.status, code: error.code, message: error.message }),
    );
    return { error: "Não foi possível enviar o link agora. Tente novamente em instantes." };
  }
  console.log(JSON.stringify({ level: "info", event: "auth.magic_link.requested" }));
  return { sent: true };
}
