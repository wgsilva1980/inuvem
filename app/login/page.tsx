"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";

interface LoginState {
  /** "email": pede o e-mail; "code": digita o código recebido; "link": link de acesso enviado. */
  step: "email" | "code" | "link";
  email?: string;
  error?: string;
}

const GENERIC_SEND_ERROR = "Não foi possível enviar agora. Tente novamente em instantes.";

export default function LoginPage() {
  const [state, setState] = useState<LoginState>({ step: "email" });
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
        setState({ step: "email", error: "O link expirou ou já foi usado. Peça um código novo: ele não depende do link." });
        setPending(false);
      })
      .catch(() => {
        setState({ step: "email", error: "O link expirou ou já foi usado. Peça um código novo: ele não depende do link." });
        setPending(false);
      });
  }, []);

  const failure = (status?: number) => (status === 429 ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : GENERIC_SEND_ERROR);

  // Os pedidos saem do navegador (via /api/auth): assim o cookie de desafio do Neon Auth fica neste
  // navegador. O acesso continua restrito no servidor: só e-mails da allowlist `admins` passam do login.
  async function sendCode(email: string) {
    setPending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      setState(error ? { step: "email", email, error: failure(error.status) } : { step: "code", email });
    } catch {
      setState({ step: "email", email, error: GENERIC_SEND_ERROR });
    } finally {
      setPending(false);
    }
  }

  async function sendLink(email: string) {
    setPending(true);
    try {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL: `${window.location.origin}/` });
      setState(error ? { step: "email", email, error: failure(error.status) } : { step: "link", email });
    } catch {
      setState({ step: "email", email, error: GENERIC_SEND_ERROR });
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\D/g, "");
    if (otp.length !== 6 || !state.email) return setState({ ...state, error: "Digite os 6 números do código." });
    setPending(true);
    try {
      const { data, error } = await authClient.signIn.emailOtp({ email: state.email, otp });
      if (error || !data) {
        setState({ ...state, error: error?.status === 429 ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : "Código incorreto ou expirado. Confira os números ou peça um código novo." });
        setPending(false);
        return;
      }
      window.location.replace("/");
    } catch {
      setState({ ...state, error: "Não foi possível entrar agora. Tente novamente em instantes." });
      setPending(false);
    }
  }

  function readEmail(form: HTMLFormElement): string | null {
    const email = String(new FormData(form).get("email") ?? "").trim().toLowerCase();
    if (!email) {
      setState({ step: "email", error: "Informe um e-mail válido." });
      return null;
    }
    return email;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1>
          <Brand className="text-xl" />
        </h1>
        <p className="mt-1 text-sm text-muted">Painel privado da loja. Entre com seu e-mail.</p>

        {state.step === "link" && (
          <div className="mt-6 flex flex-col gap-3">
            <p role="status" className="rounded-md border border-border p-3 text-sm">
              Se o e-mail tiver acesso, você receberá um link de entrada em instantes. Confira também o spam. O link vale poucos minutos, só funciona uma vez e deve ser aberto no mesmo navegador.
            </p>
            <button type="button" className="self-start text-sm underline" onClick={() => setState({ step: "email", email: state.email })}>
              Voltar
            </button>
          </div>
        )}

        {state.step === "code" && (
          <form onSubmit={verifyCode} className="mt-6 flex flex-col gap-3">
            <p role="status" className="rounded-md border border-border p-3 text-sm">
              Se o e-mail tiver acesso, enviamos um código de 6 números para <strong>{state.email}</strong>. Confira também o spam.
            </p>
            <label htmlFor="code" className="text-sm font-medium">
              Código
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              required
              autoFocus
              placeholder="000000"
              className={`${fieldClass} text-center text-lg tracking-widest`}
            />
            {state.error && (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Entrando…" : "Entrar"}
            </Button>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" className="underline disabled:opacity-50" disabled={pending} onClick={() => state.email && void sendCode(state.email)}>
                Enviar outro código
              </button>
              <button type="button" className="underline" onClick={() => setState({ step: "email", email: state.email })}>
                Usar outro e-mail
              </button>
            </div>
          </form>
        )}

        {state.step === "email" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = readEmail(event.currentTarget);
              if (email) void sendCode(email);
            }}
            className="mt-6 flex flex-col gap-3"
          >
            <label htmlFor="email" className="text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={state.email ?? ""}
              placeholder="voce@exemplo.com"
              className={fieldClass}
            />
            {state.error && (
              <p role="alert" className="text-sm text-danger">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Enviando…" : "Receber código por e-mail"}
            </Button>
            <button
              type="button"
              disabled={pending}
              className="self-start text-sm underline disabled:opacity-50"
              onClick={(event) => {
                const email = readEmail(event.currentTarget.form as HTMLFormElement);
                if (email) void sendLink(email);
              }}
            >
              Prefiro receber um link
            </button>
          </form>
        )}
      </Card>
    </main>
  );
}
