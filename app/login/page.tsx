"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { sendMagicLink } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, null);

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
          <form action={action} className="mt-6 flex flex-col gap-3">
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
