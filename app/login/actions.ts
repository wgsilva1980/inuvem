"use server";

import { z } from "zod";
import { isAdminEmail } from "@/lib/auth/admin";
import { auth } from "@/lib/auth/server";

export interface LoginState {
  sent?: boolean;
  error?: string;
}

const emailSchema = z.string().trim().toLowerCase().email();

/**
 * Envia o link de acesso só se o e-mail estiver na allowlist de admins. A resposta é a mesma
 * em qualquer caso, para não revelar quais e-mails têm acesso.
 */
export async function sendMagicLink(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Informe um e-mail válido." };

  if (await isAdminEmail(parsed.data)) {
    const { error } = await auth.signIn.magicLink({ email: parsed.data, callbackURL: "/" });
    if (error) {
      console.error(JSON.stringify({ level: "error", event: "auth.magic_link_failed", code: error.code }));
      return { error: "Não foi possível enviar o link agora. Tente novamente em instantes." };
    }
  }
  return { sent: true };
}
