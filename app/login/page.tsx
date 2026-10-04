"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth/client";

interface LoginState {
  sent?: boolean;
  error?: string;
}

export default function LoginPage() {
  const [state, setState] = useState<LoginState | null>(null);
  const [pending, setPending] = useState(false);

  // Volta do link de acesso: o Neon Auth redireciona para cá com `neon_auth_session_verifier`.
  // O getSession() do cliente envia esse código ao /api/auth, que grava a sessão neste domínio.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("neon_auth_session_verifier")) return;
    setPending(true);
    authClient
      .getSession()
      .then(({ data }) => {
        if (data?.session) {
          window.location.replace("/");
          return;
        }
        setState({ error: "Não foi possível concluir o login. Peça um novo link." });
        setPending(false);
      })
      .catch(() => {
        setState({ error: "Não foi possível concluir o login. Peça um novo link." });
        setPending(false);
      });
  }, []);

  // O pedido sai do navegador (via /api/auth): assim o cookie de desafio do Neon Auth fica neste
  // navegador e, ao voltar do link, o proxy troca o retorno por uma sessão no nosso domínio.
  // O acesso continua restrito no servidor: só e-mails da allowlist `admins` passam do login.
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!email) return setState({ error: "Informe um e-mail válido." });
    setPending(true);
    try {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: `${window.location.origin}/` });
      setState(
        error
          ? { error: error.status === 429 ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : "Não foi possível enviar o link agora. Tente novamente em instantes." }
          : { sent: true },
      );
    } catch {
      setState({ error: "Não foi possível enviar o link agora. Tente novamente em instantes." });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">INuvem</h1>
        <p className="mt-1 text-sm text-muted">Painel privado da loja. Entre com seu e-mail.</p>

        {state?.sent ? (
          <p role="status" className="mt-6 rounded-md border border-border p-3 text-sm">
            Se o e-mail tiver acesso, você receberá um link de entrada em instantes. Confira também o spam.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
            <label htmlFor="email" className="text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {state?.error && (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Enviar link de acesso"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
