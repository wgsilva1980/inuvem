"use client";

import { useActionState, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { MAX_VARIANTS, gerarCombinacoes, parseCores, parseTamanhos } from "@/lib/catalog/create";
import type { CategoryOption } from "@/lib/catalog/query";
import { criarProduto, type NovoProdutoState } from "./actions";

type Linha = { preco?: string; promo?: string; sku?: string; estoque?: string };
const label = "flex flex-col gap-1 text-sm";

export function NewProductForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState<NovoProdutoState | null, FormData>(criarProduto, null);
  const err = (name: string) => state?.fieldErrors?.[name];

  const [modo, setModo] = useState<"simples" | "variacoes">("simples");
  const [controlar, setControlar] = useState(false);
  const [coresTexto, setCoresTexto] = useState("");
  const [tamanhosTexto, setTamanhosTexto] = useState("");
  const [precoPadrao, setPrecoPadrao] = useState("");
  const [promoPadrao, setPromoPadrao] = useState("");
  const [estoquePadrao, setEstoquePadrao] = useState("");
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});

  const cores = useMemo(() => parseCores(coresTexto), [coresTexto]);
  const tamanhos = useMemo(() => parseTamanhos(tamanhosTexto), [tamanhosTexto]);
  const combos = useMemo(() => gerarCombinacoes(cores, tamanhos), [cores, tamanhos]);
  const grandeDemais = combos.length > MAX_VARIANTS;

  const editar = (chave: string, campo: keyof Linha, valor: string) => setLinhas((prev) => ({ ...prev, [chave]: { ...prev[chave], [campo]: valor } }));

  return (
    <form action={action} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Dados do produto</h2>
        <label className={label}>
          <span className="font-medium">Nome</span>
          <input name="name" required maxLength={255} className={fieldClass} aria-invalid={!!err("name")} />
          {err("name") && <span className="text-danger">{err("name")}</span>}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="description-editor" className="font-medium">
            Descrição
          </label>
          <RichTextEditor name="description" defaultValue="" id="description-editor" />
          {err("description") && <span className="text-danger">{err("description")}</span>}
        </div>
        <label className={label}>
          <span className="font-medium">Tags (separadas por vírgula)</span>
          <input name="tags" className={fieldClass} />
          {err("tags") && <span className="text-danger">{err("tags")}</span>}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="published" className="mt-1" />
          <span>
            <span className="font-medium">Publicar na loja agora</span>
            <span className="block text-muted">Desmarcado, o produto é criado como rascunho (não aparece na vitrine) e você publica quando as fotos e os dados estiverem prontos.</span>
          </span>
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
                  <input type="checkbox" name="categories" value={c.id} />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Preço e variações</h2>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">Tipo de produto</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="modo" value="simples" checked={modo === "simples"} onChange={() => setModo("simples")} className="mt-1" />
            <span>
              <span className="font-medium">Produto simples</span>
              <span className="block text-muted">Uma variante só, sem cor nem tamanho para escolher.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="modo" value="variacoes" checked={modo === "variacoes"} onChange={() => setModo("variacoes")} className="mt-1" />
            <span>
              <span className="font-medium">Com cores e tamanhos</span>
              <span className="block text-muted">Cria uma variante para cada combinação, com as propriedades COR e TAMANHO. Para tamanho único, use ÚNICO.</span>
            </span>
          </label>
        </fieldset>

        {modo === "simples" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <label className={label}>
              <span className="text-muted">Preço (R$)</span>
              <input name="preco" inputMode="decimal" required className={fieldClass} aria-invalid={!!err("preco")} />
              {err("preco") && <span className="text-danger">{err("preco")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">Promocional (R$)</span>
              <input name="promocional" inputMode="decimal" className={fieldClass} />
              {err("promocional") && <span className="text-danger">{err("promocional")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">SKU</span>
              <input name="sku" maxLength={255} placeholder="Automático" className={fieldClass} />
              {err("sku") && <span className="text-danger">{err("sku")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">Peso (kg)</span>
              <input name="peso" inputMode="decimal" className={fieldClass} />
              {err("peso") && <span className="text-danger">{err("peso")}</span>}
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" name="controlar_estoque" checked={controlar} onChange={(e) => setControlar(e.target.checked)} />
              <span>Controlar estoque</span>
            </label>
            {controlar && (
              <label className={label}>
                <span className="text-muted">Estoque</span>
                <input name="estoque" inputMode="numeric" className={fieldClass} />
                {err("estoque") && <span className="text-danger">{err("estoque")}</span>}
              </label>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>
                <span className="font-medium">Cores</span>
                <textarea value={coresTexto} onChange={(e) => setCoresTexto(e.target.value)} rows={3} placeholder="Preta, Branca, Azul Claro" className={fieldClass} />
                <span className="text-xs text-muted">Separe por vírgula ou linha. A grafia é padronizada (“azul claro” vira “Azul Claro”).</span>
              </label>
              <label className={label}>
                <span className="font-medium">Tamanhos</span>
                <textarea value={tamanhosTexto} onChange={(e) => setTamanhosTexto(e.target.value)} rows={3} placeholder="PP, P, M, G, GG" className={fieldClass} />
                <span className="text-xs text-muted">Tamanhos ficam em maiúsculas. Para tamanho único, escreva ÚNICO.</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <label className={label}>
                <span className="text-muted">Preço padrão (R$)</span>
                <input value={precoPadrao} onChange={(e) => setPrecoPadrao(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
              <label className={label}>
                <span className="text-muted">Promocional padrão (R$)</span>
                <input value={promoPadrao} onChange={(e) => setPromoPadrao(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
              <label className={label}>
                <span className="text-muted">Peso (kg), todas</span>
                <input name="peso_v" inputMode="decimal" className={fieldClass} aria-invalid={!!err("peso_v")} />
                {err("peso_v") && <span className="text-danger">{err("peso_v")}</span>}
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="controlar_estoque_v" checked={controlar} onChange={(e) => setControlar(e.target.checked)} />
                <span>Controlar estoque</span>
              </label>
              {controlar && (
                <label className={label}>
                  <span className="text-muted">Estoque padrão</span>
                  <input value={estoquePadrao} onChange={(e) => setEstoquePadrao(e.target.value)} inputMode="numeric" className={fieldClass} />
                </label>
              )}
            </div>
            <p className="text-xs text-muted">Os valores padrão preenchem todas as variantes abaixo; você pode ajustar uma por uma.</p>

            {combos.length === 0 ? (
              <p className="rounded-md border border-border p-3 text-sm text-muted">Digite as cores e os tamanhos acima para ver as variantes.</p>
            ) : grandeDemais ? (
              <Alert tone="danger">
                São {combos.length} variantes; o máximo ao cadastrar é {MAX_VARIANTS}. Reduza as cores ou os tamanhos (você pode criar mais depois, na tela do produto).
              </Alert>
            ) : (
              <>
                <input type="hidden" name="vcount" value={combos.length} />
                <p className="text-sm font-medium">
                  {combos.length} {combos.length === 1 ? "variante" : "variantes"}
                </p>
                <ul className="flex flex-col gap-3">
                  {combos.map((c, i) => {
                    const chave = `${c.cor}|${c.tamanho}`;
                    const l = linhas[chave] ?? {};
                    return (
                      <li key={chave} className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <input type="hidden" name={`v_${i}_cor`} value={c.cor} />
                        <input type="hidden" name={`v_${i}_tam`} value={c.tamanho} />
                        <p className="text-sm font-medium">
                          {c.cor} / {c.tamanho}
                        </p>
                        {err(`v_${i}_cor`) && <p className="text-sm text-danger">{err(`v_${i}_cor`)}</p>}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <label className={label}>
                            <span className="text-muted">Preço (R$)</span>
                            <input name={`v_${i}_preco`} value={l.preco ?? precoPadrao} onChange={(e) => editar(chave, "preco", e.target.value)} inputMode="decimal" className={fieldClass} aria-invalid={!!err(`v_${i}_preco`)} />
                            {err(`v_${i}_preco`) && <span className="text-danger">{err(`v_${i}_preco`)}</span>}
                          </label>
                          <label className={label}>
                            <span className="text-muted">Promocional</span>
                            <input name={`v_${i}_promo`} value={l.promo ?? promoPadrao} onChange={(e) => editar(chave, "promo", e.target.value)} inputMode="decimal" className={fieldClass} />
                            {err(`v_${i}_promo`) && <span className="text-danger">{err(`v_${i}_promo`)}</span>}
                          </label>
                          <label className={label}>
                            <span className="text-muted">SKU</span>
                            <input name={`v_${i}_sku`} value={l.sku ?? ""} onChange={(e) => editar(chave, "sku", e.target.value)} maxLength={255} placeholder="Automático" className={fieldClass} />
                            {err(`v_${i}_sku`) && <span className="text-danger">{err(`v_${i}_sku`)}</span>}
                          </label>
                          {controlar && (
                            <label className={label}>
                              <span className="text-muted">Estoque</span>
                              <input name={`v_${i}_estoque`} value={l.estoque ?? estoquePadrao} onChange={(e) => editar(chave, "estoque", e.target.value)} inputMode="numeric" className={fieldClass} aria-invalid={!!err(`v_${i}_estoque`)} />
                              {err(`v_${i}_estoque`) && <span className="text-danger">{err(`v_${i}_estoque`)}</span>}
                            </label>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {err("variantes") && <p className="text-sm text-danger">{err("variantes")}</p>}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">SEO</h2>
        <label className={label}>
          <span className="font-medium">Título (até 70 caracteres)</span>
          <input name="seo_title" maxLength={70} className={fieldClass} />
          {err("seo_title") && <span className="text-danger">{err("seo_title")}</span>}
        </label>
        <label className={label}>
          <span className="font-medium">Descrição (até 320 caracteres)</span>
          <textarea name="seo_description" rows={3} maxLength={320} className={fieldClass} />
          {err("seo_description") && <span className="text-danger">{err("seo_description")}</span>}
        </label>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm" aria-live="polite">
            {state?.message ? <Alert tone="danger" className="border-0 p-0">{state.message}</Alert> : <span className="text-muted">Nada é enviado à loja até você clicar em “Criar produto”.</span>}
          </div>
          <Button type="submit" disabled={pending || (modo === "variacoes" && (combos.length === 0 || grandeDemais))} className="min-h-11">
            {pending ? "Criando…" : "Criar produto"}
          </Button>
        </div>
      </div>
    </form>
  );
}
