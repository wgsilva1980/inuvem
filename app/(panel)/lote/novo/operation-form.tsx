"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CategoryOption } from "@/lib/catalog/query";
import { createBulk, type BulkFormState } from "../actions";
import { fieldBase } from "@/components/ui/field";
const label = "flex flex-col gap-1 text-sm";

export function OperationForm({ selecao, total, categories }: { selecao: string; total: number; categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState<BulkFormState | null, FormData>(createBulk, null);
  const [tipo, setTipo] = useState("preco");
  const [precoModo, setPrecoModo] = useState("aumentar");
  const [promoModo, setPromoModo] = useState("desconto");
  const [estoqueModo, setEstoqueModo] = useState("definir");

  const showRounding = tipo === "preco" || (tipo === "promocao" && promoModo === "desconto");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="selecao" value={selecao} />
      <Card className="flex flex-col gap-4">
        <label className={label}>
          <span className="font-medium">O que fazer com os {total} {total === 1 ? "produto" : "produtos"}?</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={fieldBase}>
            <option value="preco">Alterar preço</option>
            <option value="promocao">Preço promocional (desconto)</option>
            <option value="estoque">Alterar estoque</option>
            <option value="publicar">Publicar ou despublicar</option>
            <option value="categoria">Adicionar ou remover de uma categoria</option>
            <option value="propriedades">Padronizar propriedades (COR e TAMANHO)</option>
          </select>
        </label>

        {tipo === "preco" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className={label}>
              <span className="text-muted">Ação</span>
              <select name="preco_modo" value={precoModo} onChange={(e) => setPrecoModo(e.target.value)} className={fieldBase}>
                <option value="aumentar">Aumentar</option>
                <option value="diminuir">Diminuir</option>
                <option value="definir">Definir como</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-muted">{precoModo === "definir" ? "Novo valor (R$)" : "Valor"}</span>
              <input name="preco_valor" inputMode="decimal" required placeholder={precoModo === "definir" ? "99,90" : "10"} className={fieldBase} />
            </label>
            {precoModo !== "definir" && (
              <label className={label}>
                <span className="text-muted">Em</span>
                <select name="preco_unidade" defaultValue="percentual" className={fieldBase}>
                  <option value="percentual">% (percentual)</option>
                  <option value="valor">R$ (valor fixo)</option>
                </select>
              </label>
            )}
            <label className={label}>
              <span className="text-muted">Aplicar em</span>
              <select name="preco_alvo" defaultValue="preco" className={fieldBase}>
                <option value="preco">Preço</option>
                <option value="promocional">Preço promocional</option>
              </select>
            </label>
          </div>
        )}

        {tipo === "promocao" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={label}>
              <span className="text-muted">Ação</span>
              <select name="promo_modo" value={promoModo} onChange={(e) => setPromoModo(e.target.value)} className={fieldBase}>
                <option value="desconto">Definir desconto sobre o preço</option>
                <option value="remover">Remover o preço promocional</option>
              </select>
            </label>
            {promoModo === "desconto" && (
              <label className={label}>
                <span className="text-muted">Desconto (%)</span>
                <input name="promo_percent" inputMode="decimal" required placeholder="15" className={fieldBase} />
              </label>
            )}
          </div>
        )}

        {tipo === "estoque" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={label}>
              <span className="text-muted">Ação</span>
              <select name="estoque_modo" value={estoqueModo} onChange={(e) => setEstoqueModo(e.target.value)} className={fieldBase}>
                <option value="definir">Definir como</option>
                <option value="aumentar">Aumentar em</option>
                <option value="diminuir">Diminuir em</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-muted">Quantidade</span>
              <input name="estoque_valor" inputMode="numeric" required placeholder="10" className={fieldBase} />
            </label>
            <p className="self-end pb-2 text-xs text-muted">Só variantes com controle de estoque são alteradas.</p>
          </div>
        )}

        {tipo === "publicar" && (
          <label className={label}>
            <span className="text-muted">Ação</span>
            <select name="publicar_modo" defaultValue="publicar" className={fieldBase}>
              <option value="publicar">Publicar na loja</option>
              <option value="despublicar">Despublicar (ocultar da loja)</option>
            </select>
          </label>
        )}

        {tipo === "propriedades" && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Renomeia as duas propriedades das variações para <strong>COR</strong> e <strong>TAMANHO</strong> (por exemplo “Cor | Tam”, “COR | TAM”, “Cor | Tamanho”). Os valores das variantes (Branca, PP…) não mudam.
            </p>
            <p className="text-muted">
              Ficam de fora, com o motivo na pré-visualização: produtos que já estão certos, com a ordem invertida (TAMANHO antes de COR), com uma só propriedade, sem propriedades ou com nomes que o painel não reconhece.
            </p>
          </div>
        )}

        {tipo === "categoria" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={label}>
              <span className="text-muted">Ação</span>
              <select name="categoria_modo" defaultValue="adicionar" className={fieldBase}>
                <option value="adicionar">Adicionar à categoria</option>
                <option value="remover">Remover da categoria</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-muted">Categoria</span>
              <select name="categoria_id" required defaultValue="" className={fieldBase}>
                <option value="" disabled>
                  Escolha…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {showRounding && (
          <label className={label}>
            <span className="text-muted">Arredondamento do resultado</span>
            <select name="arredondar" defaultValue="nenhum" className={`${fieldBase} sm:max-w-xs`}>
              <option value="nenhum">Sem arredondamento</option>
              <option value="90">Terminar em ,90</option>
              <option value="00">Reais inteiros</option>
            </select>
          </label>
        )}
      </Card>

      {state?.message && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm text-danger">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Calculando…" : "Ver pré-visualização"}
        </Button>
        <p className="text-sm text-muted">Nada é enviado à loja nesta etapa: você confere o antes e o depois e só então confirma.</p>
      </div>
    </form>
  );
}
