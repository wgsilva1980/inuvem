"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RichTextEditor } from "@/components/rich-text-editor";
import { DescricaoIa } from "./descricao-ia";
import { SeoIa } from "./seo-ia";
import { juntarTags } from "./sugerir-ia";
import type { CategoryOption, ProductDetail } from "@/lib/catalog/query";
import Link from "next/link";
import type { Fornecedor } from "@/lib/catalog/fornecedor";
import { saveProduct, type SaveState } from "./actions";
import { fieldClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { FieldErrorsContext } from "./save-context";

export function ProductForm({ product, categories, fornecedores = [], fornecedorId = null, children }: { product: ProductDetail; categories: CategoryOption[]; fornecedores?: Fornecedor[]; fornecedorId?: string | null; children?: ReactNode }) {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(saveProduct.bind(null, Number(product.id)), null);
  const selected = new Set(product.categories.map((c) => c.id));
  const err = (name: string) => state?.fieldErrors?.[name];

  // Alterações ainda não salvas: avisa ao fechar/recarregar a aba. Volta a "limpo" quando o espelho é atualizado (salvou ou recarregou).
  const formKey = `${product.updated_at_remote ?? product.id}|${product.variants.map((v) => [v.id, v.sku, v.price, v.promotional_price, v.stock, v.stock_management, v.image_id, v.weight, JSON.stringify(v.values)].join("¦")).join("|")}|${product.attributes.join("¦")}`;
  const [dirty, setDirty] = useState(false);
  // Descrição escrita pela IA: o editor é recriado com o novo texto (a descrição só vai para a loja ao salvar).
  const formRef = useRef<HTMLFormElement>(null);
  const [descInicial, setDescInicial] = useState(product.description ?? "");
  const [descVersao, setDescVersao] = useState(0);
  const campo = (nome: string) => formRef.current?.elements.namedItem(nome) as HTMLInputElement | HTMLTextAreaElement | null;
  useEffect(() => setDirty(false), [formKey]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  return (
    // `key` recria o formulário com os valores novos quando o espelho é atualizado (conflito ou salvamento).
    <form key={formKey} ref={formRef} action={action} onChange={() => setDirty(true)} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Nome</span>
          <input name="name" defaultValue={product.name} required maxLength={255} className={fieldClass} aria-invalid={!!err("name")} />
          {err("name") && <span className="text-danger">{err("name")}</span>}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <label htmlFor="description-editor" className="font-medium">
              Descrição
            </label>
            <DescricaoIa
              produtoId={product.id}
              descricaoAtual={() => (formRef.current?.elements.namedItem("description") as HTMLInputElement | null)?.value ?? ""}
              aoGerar={({ html, tags }) => {
                setDescInicial(html);
                setDescVersao((v) => v + 1);
                const t = campo("tags");
                if (t && tags) t.value = juntarTags(t.value, tags);
                setDirty(true);
              }}
            />
          </div>
          <RichTextEditor key={descVersao} name="description" defaultValue={descInicial} id="description-editor" onChange={() => setDirty(true)} />
          {err("description") && <span className="text-danger">{err("description")}</span>}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tags (separadas por vírgula)</span>
          <input name="tags" defaultValue={product.tags ?? ""} className={fieldClass} />
          {err("tags") && <span className="text-danger">{err("tags")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Fornecedor</span>
          <select name="fornecedor_id" defaultValue={fornecedorId ?? ""} className={fieldClass} aria-invalid={!!err("fornecedor_id")}>
            <option value="">Sem fornecedor</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            Escolha entre os contatos do tipo “fornecedor”. Fica só no painel (a Nuvemshop não tem esse campo).{" "}
            <Link href="/contatos" className="underline">
              Cadastrar ou editar fornecedores
            </Link>
          </span>
          {err("fornecedor_id") && <span className="text-danger">{err("fornecedor_id")}</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="published" defaultChecked={product.published} />
          <span className="font-medium">Publicado na loja</span>
        </label>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">SEO</h2>
          <SeoIa
            produtoId={product.id}
            jaPreenchido={() => (campo("seo_title")?.value.trim() ?? "") !== "" || (campo("seo_description")?.value.trim() ?? "") !== ""}
            aoGerar={({ titulo, descricao }) => {
              const t = campo("seo_title");
              const d = campo("seo_description");
              if (t) t.value = titulo;
              if (d) d.value = descricao;
              setDirty(true);
            }}
          />
        </div>
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

      <FieldErrorsContext.Provider value={state?.fieldErrors}>{children}</FieldErrorsContext.Provider>

      {/* Fixa no rodapé da janela durante toda a página (não só enquanto o formulário está à vista). */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {state?.message ? (
              <Alert tone={state.ok ? "success" : "danger"} className="border-0 p-0">
                {state.message}
              </Alert>
            ) : dirty ? (
              <span className="text-warning">Alterações não salvas</span>
            ) : (
              <span className="text-muted">Nenhuma alteração pendente</span>
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
