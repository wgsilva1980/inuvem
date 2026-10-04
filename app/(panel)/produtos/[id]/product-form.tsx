"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RichTextEditor } from "@/components/rich-text-editor";
import type { CategoryOption, ProductDetail } from "@/lib/catalog/query";
import { saveProduct, type SaveState } from "./actions";
import { fieldClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

export function ProductForm({ product, categories }: { product: ProductDetail; categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(saveProduct.bind(null, Number(product.id)), null);
  const selected = new Set(product.categories.map((c) => c.id));
  const err = (name: string) => state?.fieldErrors?.[name];

  // Alterações ainda não salvas: avisa ao fechar/recarregar a aba. Volta a "limpo" quando o espelho é atualizado (salvou ou recarregou).
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [product.updated_at_remote, product.id]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  return (
    // `key` recria o formulário com os valores novos quando o espelho é atualizado (conflito ou salvamento).
    <form key={product.updated_at_remote ?? product.id} action={action} onChange={() => setDirty(true)} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nome</span>
          <input name="name" defaultValue={product.name} required maxLength={255} className={fieldClass} aria-invalid={!!err("name")} />
          {err("name") && <span className="text-danger">{err("name")}</span>}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="description-editor" className="font-medium">
            Descrição
          </label>
          <RichTextEditor name="description" defaultValue={product.description ?? ""} id="description-editor" onChange={() => setDirty(true)} />
          {err("description") && <span className="text-danger">{err("description")}</span>}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tags (separadas por vírgula)</span>
          <input name="tags" defaultValue={product.tags ?? ""} className={fieldClass} />
          {err("tags") && <span className="text-danger">{err("tags")}</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="published" defaultChecked={product.published} />
          <span className="font-medium">Publicado na loja</span>
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">SEO</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Título (até 70 caracteres)</span>
          <input name="seo_title" defaultValue={product.seo_title} maxLength={70} className={fieldClass} />
          {err("seo_title") && <span className="text-danger">{err("seo_title")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Descrição (até 320 caracteres)</span>
          <textarea name="seo_description" defaultValue={product.seo_description} rows={3} maxLength={320} className={fieldClass} />
          {err("seo_description") && <span className="text-danger">{err("seo_description")}</span>}
        </label>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Categorias</h2>
        {categories.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nenhuma categoria sincronizada.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="categories" value={c.id} defaultChecked={selected.has(c.id)} />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Fixa no rodapé da janela durante toda a página (não só enquanto o formulário está à vista). */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {state?.message ? (
              <Alert tone={state.ok ? "success" : "danger"} className="border-0 p-0">
                {state.message}
              </Alert>
            ) : dirty ? (
              <span className="text-warning">Dados do produto: alterações não salvas</span>
            ) : (
              <span className="text-muted">Dados do produto: nenhuma alteração pendente</span>
            )}
          </div>
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? "Salvando…" : "Salvar na Nuvemshop"}
          </Button>
        </div>
      </div>
    </form>
  );
}
