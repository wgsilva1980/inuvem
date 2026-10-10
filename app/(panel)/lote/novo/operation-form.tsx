"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CategoryOption } from "@/lib/catalog/query";
import type { ProdutoFaltando } from "@/lib/bulk/operations";
import { createBulk, type BulkFormState } from "../actions";
import { fieldBase } from "@/components/ui/field";
const label = "flex flex-col gap-1 text-sm";

export function OperationForm({ selecao, total, categories, faltando, semNome = 0, blocos = [] }: { selecao: string; total: number; categories: CategoryOption[]; faltando: ProdutoFaltando[]; semNome?: number; blocos?: Array<{ id: string; name: string }> }) {
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
            <option value="conteudo">Aplicar bloco de conteúdo na descrição (tabela de medidas, trocas…)</option>
            <option value="propriedades">Padronizar propriedades (COR e TAMANHO)</option>
            <option value="valores">Padronizar grafia dos valores (cores e tamanhos)</option>
            <option value="ordem">Corrigir a ordem das propriedades (COR antes de TAMANHO)</option>
            <option value="completar">Completar COR e TAMANHO que faltam (você informa os valores)</option>
            <option value="sku">Ajustar SKUs (numerar os vazios e corrigir repetidos)</option>
            <option value="google">Preencher faixa etária e sexo (Instagram e Google Shopping)</option>
            <option value="excluir">Excluir produtos (não dá para desfazer)</option>
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

        {tipo === "valores" && (
          <div className="flex flex-col gap-2 text-sm">
            <p>Padroniza como os valores são escritos nas propriedades <strong>COR</strong> e <strong>TAMANHO</strong> (reconhecidas pelo nome, inclusive “Cor”, “Tam”, “Tamanho”):</p>
            <ul className="list-disc pl-5">
              <li>
                <strong>Cores</strong> com inicial maiúscula em cada palavra: “AZUL CLARO” e “Azul claro” viram “Azul Claro”.
              </li>
              <li>
                <strong>Tamanhos</strong> em maiúsculas: “pp” vira “PP”. O tamanho único fica numa grafia só: “UNICO”, “Único” e “único” viram “ÚNICO”.
              </li>
            </ul>
            <p className="text-muted">
              Outras propriedades não são alteradas. Ficam de fora, com o motivo na pré-visualização, os produtos já padronizados e os que ficariam com duas variantes iguais (por exemplo “Azul” e “AZUL” no mesmo tamanho).
            </p>
          </div>
        )}

        {tipo === "completar" && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Para produtos que têm só uma das propriedades (ou nenhuma), acrescenta <strong>COR</strong> e/ou <strong>TAMANHO</strong> e coloca o valor que você digitar em todas as variantes do produto. A loja não sabe a cor nem o tamanho, por isso <strong>quem informa é você</strong>.
            </p>
            {semNome > 0 && (
              <p className="rounded-md border border-border p-3 text-muted">
                {semNome} {semNome === 1 ? "produto da seleção está sem nome" : "produtos da seleção estão sem nome"} na loja e {semNome === 1 ? "ficou" : "ficaram"} fora desta lista: antes de dar cor ou tamanho, falta dar um nome (ou excluir o produto).
              </p>
            )}
            {faltando.length === 0 ? (
              <p className="rounded-md border border-border p-3 text-muted">Nenhum dos produtos selecionados está sem COR ou TAMANHO. Volte à lista e selecione os produtos que faltam.</p>
            ) : (
              <>
                <input type="hidden" name="completar_ids" value={faltando.map((p) => p.id).join(",")} />
                <p className="text-muted">
                  Deixe os campos de um produto em branco para não mexer nele. Cores ficam com inicial maiúscula (“preta” vira “Preta”) e tamanho em maiúsculas (“unico” vira “ÚNICO”). Você confere tudo na pré-visualização antes de enviar.
                </p>
                <ul className="flex flex-col gap-3">
                  {faltando.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted">
                          Hoje: {p.atributos.length > 0 ? p.atributos.join(" | ") : "sem propriedades"} · {p.variantes} {p.variantes === 1 ? "variante" : "variantes"} · {p.published ? "publicado" : "não publicado"}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {p.faltam.includes("COR") && (
                          <label className={label}>
                            <span className="text-muted">COR (falta)</span>
                            <input name={`cor_${p.id}`} maxLength={100} placeholder="Ex.: Preta" className={fieldBase} />
                          </label>
                        )}
                        {p.faltam.includes("TAMANHO") && (
                          <label className={label}>
                            <span className="text-muted">TAMANHO (falta)</span>
                            <input name={`tam_${p.id}`} maxLength={100} placeholder="Ex.: ÚNICO, M, 38" className={fieldBase} />
                          </label>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tipo === "google" && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Preenche <strong>Faixa etária = Adulto</strong> e <strong>Sexo = Feminino</strong> nas variantes em que esses campos estão vazios, para os anúncios do Instagram e do Google Shopping.
            </p>
            <p className="text-muted">Quem já tem faixa etária ou sexo preenchido não muda. O lote pode ser revertido.</p>
          </div>
        )}

        {tipo === "sku" && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Dá um <strong>SKU</strong> às variantes que estão sem código e renumera os <strong>códigos repetidos</strong>, seguindo a numeração da loja (o próximo número depois do maior que existe hoje).
            </p>
            <p className="text-muted">
              Códigos que já são únicos não mudam. Quando um código aparece em mais de uma variante, a mais antiga fica com ele e as outras recebem números novos. Você confere cada troca na pré-visualização e pode reverter o lote. Para pegar a loja toda, selecione todos os produtos.
            </p>
          </div>
        )}

        {tipo === "excluir" && (
          <div className="flex flex-col gap-2 rounded-md border border-danger p-3 text-sm">
            <p className="font-medium text-danger">Atenção: exclusão definitiva.</p>
            <p>
              Cada um dos {total} {total === 1 ? "produto selecionado" : "produtos selecionados"} será excluído da Nuvemshop, com as variantes e as imagens. <strong>Este lote não pode ser revertido.</strong>
            </p>
            <p className="text-muted">
              Na pré-visualização você confere a lista inteira e, para aplicar, digita EXCLUIR. Se um produto for renomeado na loja depois da pré-visualização, ele fica de fora. Para só tirar da vitrine, use “Publicar ou despublicar”, que dá para desfazer.
            </p>
          </div>
        )}

        {tipo === "ordem" && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Em produtos que têm <strong>TAMANHO antes de COR</strong>, coloca <strong>COR antes de TAMANHO</strong> e troca também os dois valores de cada variante, para cada valor continuar sob a propriedade certa (“P / Preta” vira “Preta / P”).
            </p>
            <p className="text-muted">
              Cada produto é alterado em várias etapas na loja. Se uma etapa falhar, ou se a loja não ficar como esperado, o painel desfaz sozinho o que já tinha aplicado e mostra o resultado. Produtos que já estão na ordem certa, ou que não têm exatamente duas propriedades reconhecidas, ficam de fora com o motivo na pré-visualização.
            </p>
          </div>
        )}

        {tipo === "conteudo" && (
          <div className="flex flex-col gap-3 text-sm">
            {blocos.length === 0 ? (
              <p className="rounded-md border border-border p-3 text-muted">
                Ainda não há blocos de conteúdo. Crie o primeiro em <a href="/conteudo" className="underline">Conteúdo</a> (por exemplo a tabela de medidas ou a política de troca) e volte aqui.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className={label}>
                    <span className="text-muted">Ação</span>
                    <select name="conteudo_modo" defaultValue="aplicar" className={fieldBase}>
                      <option value="aplicar">Aplicar o bloco</option>
                      <option value="remover">Remover o bloco</option>
                    </select>
                  </label>
                  <label className={label}>
                    <span className="text-muted">Bloco</span>
                    <select name="conteudo_bloco" required defaultValue="" className={fieldBase}>
                      <option value="" disabled>
                        Escolha…
                      </option>
                      {blocos.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    <span className="text-muted">Onde (ao aplicar)</span>
                    <select name="conteudo_posicao" defaultValue="fim" className={fieldBase}>
                      <option value="fim">No fim da descrição</option>
                      <option value="inicio">No começo da descrição</option>
                    </select>
                  </label>
                </div>
                <p className="text-muted">
                  O bloco entra na descrição de cada produto com uma marca invisível do painel. Se o produto já tem o bloco, ele é <strong>atualizado no mesmo lugar</strong> (sem duplicar), e “Remover” tira só o bloco. O resto da descrição não muda. Você confere tudo na pré-visualização e pode reverter o lote. Para aplicar a uma categoria, filtre os produtos por ela na lista e use “Operação em massa”.
                </p>
              </>
            )}
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
