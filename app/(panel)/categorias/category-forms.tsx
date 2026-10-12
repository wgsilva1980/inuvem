"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createCategoryAction, deleteCategoryAction, devolverCategoriaAction, updateCategoryAction, visibilidadeCategoriaAction, type CategoryActionState } from "./actions";
import { fieldClass } from "@/components/ui/field";

export interface ParentOption {
  id: number;
  label: string;
}

function ParentSelect({ options, value }: { options: ParentOption[]; value: number | null }) {
  return (
    <select name="parent" defaultValue={value === null ? "" : String(value)} className={fieldClass} aria-label="Categoria pai">
      <option value="">(nenhuma: categoria principal)</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Feedback({ state }: { state: CategoryActionState | null }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}

export function CreateCategoryForm({ options }: { options: ParentOption[] }) {
  const [state, action, pending] = useActionState<CategoryActionState | null, FormData>(createCategoryAction, null);
  return (
    // `key` limpa o formulário depois de criar com sucesso
    <form key={state?.ok ? Date.now() : "novo"} action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nome</span>
          <input name="name" required maxLength={100} className={fieldClass} placeholder="Ex.: Vestidos" />
          {state?.fieldErrors?.name && <span className="text-danger">{state.fieldErrors.name}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Dentro de</span>
          <ParentSelect options={options} value={null} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar categoria"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function EditCategoryForm({ id, name, parent, options }: { id: number; name: string; parent: number | null; options: ParentOption[] }) {
  const [state, action, pending] = useActionState<CategoryActionState | null, FormData>(updateCategoryAction.bind(null, id), null);
  return (
    <form key={`${name}|${parent}`} action={action} className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Nome</span>
          <input name="name" defaultValue={name} required maxLength={100} className={fieldClass} />
          {state?.fieldErrors?.name && <span className="text-danger">{state.fieldErrors.name}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Dentro de</span>
          <ParentSelect options={options} value={parent} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function DeleteCategoryButton({ id, name, products, hasChildren }: { id: number; name: string; products: number; hasChildren: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CategoryActionState | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="danger"
        className="min-h-8 px-3 py-1"
        disabled={pending || hasChildren}
        title={hasChildren ? "Mova ou apague as subcategorias antes" : undefined}
        onClick={() => {
          const aviso = products > 0 ? `\n\n${products} ${products === 1 ? "produto perde" : "produtos perdem"} esta categoria.` : "";
          if (window.confirm(`Apagar a categoria "${name}" na Nuvemshop? Isso não pode ser desfeito.${aviso}`)) startTransition(async () => setState(await deleteCategoryAction(id)));
        }}
      >
        {pending ? "Apagando…" : "Apagar"}
      </Button>
      {state?.message && !state.ok && (
        <span role="alert" className="text-sm text-danger">
          {state.message}
        </span>
      )}
    </span>
  );
}

/** Oculta ou mostra a categoria na loja; se ela é "fixa" (mostrada à mão), oferece devolvê-la à automação. */
export function VisibilidadeCategoria({ id, nome, oculta, daAutomacao, fixa }: { id: number; nome: string; oculta: boolean; daAutomacao: boolean; fixa: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CategoryActionState | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      {oculta ? <span className="rounded-full border border-border-strong px-2 py-0.5 text-xs">Oculta na loja{daAutomacao ? " (pela automação)" : ""}</span> : fixa ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">Sempre visível</span> : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-8 px-3 py-1"
        disabled={pending}
        onClick={() => {
          if (!oculta && !window.confirm(`Ocultar a categoria "${nome}" na loja? Ela some do menu e da vitrine; os produtos continuam nela. Dá para mostrar de novo quando quiser.`)) return;
          startTransition(async () => setState(await visibilidadeCategoriaAction(id, oculta ? "visible" : "hidden")));
        }}
      >
        {pending ? "Salvando…" : oculta ? "Mostrar na loja" : "Ocultar da loja"}
      </Button>
      {fixa && !oculta && (
        <button
          type="button"
          disabled={pending}
          className="text-xs text-muted underline hover:text-foreground"
          onClick={() => startTransition(async () => setState(await devolverCategoriaAction(id)))}
        >
          Devolver à automação
        </button>
      )}
      {state?.message && (
        <span role={state.ok ? "status" : "alert"} className={`w-full text-xs ${state.ok ? "text-muted" : "text-danger"}`}>
          {state.message}
        </span>
      )}
    </span>
  );
}
