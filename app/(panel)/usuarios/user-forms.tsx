"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import { PERFIS, PERFIS_LISTA, type Perfil } from "@/lib/auth/perfis";
import { addUser, mudarPerfil, removeUser, type UserActionState } from "./actions";

export function AddUserForm() {
  const [state, action, pending] = useActionState<UserActionState | null, FormData>(addUser, null);
  return (
    // `key` limpa o campo depois de adicionar
    <form key={state?.ok ? "ok" : "novo"} action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">E-mail de quem vai ter acesso</span>
        <input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="nome@dominio.com" className={`${fieldClass} sm:max-w-md`} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Perfil</span>
        <select name="perfil" defaultValue="admin" className={`${fieldClass} sm:max-w-md`}>
          {PERFIS_LISTA.map((p) => (
            <option key={p} value={p}>
              {PERFIS[p].rotulo}
            </option>
          ))}
        </select>
      </label>
      <ul className="flex flex-col gap-1 text-xs text-muted">
        {PERFIS_LISTA.map((p) => (
          <li key={p}>
            <strong>{PERFIS[p].rotulo}:</strong> {PERFIS[p].descricao}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adicionando…" : "Adicionar usuário"}
        </Button>
        {state?.message && (
          <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export function RemoveUserButton({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className="text-sm text-danger underline disabled:opacity-50"
        onClick={() => {
          if (window.confirm(`Remover o acesso de ${email}? Essa pessoa não conseguirá mais entrar no painel.`)) {
            start(async () => {
              const r = await removeUser(email);
              if (!r.ok) setMessage(r.message ?? "Não foi possível remover.");
            });
          }
        }}
      >
        {pending ? "Removendo…" : "Remover"}
      </button>
      {message && (
        <span role="alert" className="text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}

export function PerfilSelect({ email, perfil }: { email: string; perfil: Perfil }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex flex-col gap-1">
      <select
        aria-label={`Perfil de ${email}`}
        value={perfil}
        disabled={pending}
        className={`${fieldClass} min-h-11 py-1 text-sm`}
        onChange={(e) => {
          const novo = e.target.value;
          setMessage(null);
          start(async () => {
            const r = await mudarPerfil(email, novo);
            if (!r.ok) setMessage(r.message ?? "Não foi possível mudar o perfil.");
          });
        }}
      >
        {PERFIS_LISTA.map((p) => (
          <option key={p} value={p}>
            {PERFIS[p].rotulo}
          </option>
        ))}
      </select>
      {message && (
        <span role="alert" className="text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}
