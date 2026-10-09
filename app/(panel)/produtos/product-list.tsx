"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CatalogItem } from "@/lib/catalog/query";

const brl = (value: string | null) => (value === null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const priceRange = (min: string | null, max: string | null) => (min === max ? brl(min) : `${brl(min)} – ${brl(max)}`);

function Thumb({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return (
      <span aria-label="Sem imagem" role="img" className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong text-[10px] leading-tight text-muted">
        sem foto
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- miniaturas pequenas vindas do CDN da Nuvemshop
  return <img src={url} alt={name} width={48} height={48} loading="lazy" decoding="async" className="size-12 shrink-0 rounded-md border border-border bg-border/40 object-cover" />;
}

/** Lista de produtos com caixas de seleção. A seleção vai para a tela de operações em massa pela URL. */
export function ProductList({ items, total, filterQuery }: { items: CatalogItem[]; total: number; filterQuery: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.id)));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input type="checkbox" className="size-5" checked={allOnPage} onChange={toggleAll} aria-label="Selecionar todos desta página" />
          <span>Selecionar página</span>
        </label>
        {total > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/lote/novo${filterQuery ? `?${filterQuery}` : ""}`} className={buttonClass("outline", "min-h-9 px-3 py-1")}>
              Aplicar a todos os {total} {total === 1 ? "resultado" : "resultados"} do filtro
            </Link>
            <Link href={`/promocoes/nova${filterQuery ? `?${filterQuery}` : ""}`} className={buttonClass("outline", "min-h-9 px-3 py-1")}>
              Agendar promoção
            </Link>
          </div>
        )}
      </div>

      <Card className="p-0 sm:p-0">
        {items.length === 0 ? (
          <EmptyState title="Nenhum produto encontrado com esses filtros.">
            <Link href="/produtos" className={buttonClass("outline")}>
              Limpar filtros
            </Link>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((p) => (
              <li key={p.id} className="flex items-center">
                <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center self-stretch pl-2">
                  <input type="checkbox" className="size-5" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Selecionar ${p.name}`} />
                </label>
                <Link href={`/produtos/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 pl-2 hover:bg-border/30">
                  <Thumb url={p.thumb_url} name={p.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted">
                        {p.categories.map((c) => c.name).join(", ") || "Sem categoria"} · {p.variant_count} {p.variant_count === 1 ? "variante" : "variantes"} · {p.image_count} {p.image_count === 1 ? "imagem" : "imagens"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span>{priceRange(p.price_min, p.price_max)}</span>
                      <span className="text-muted">Estoque: {p.stock_total ?? "—"}</span>
                      <Badge tone={p.published ? "success" : "neutral"}>{p.published ? "Publicado" : "Não publicado"}</Badge>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected.size > 0 && (
        <div role="region" aria-label="Ações para os produtos selecionados" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium" aria-live="polite">
              {selected.size} {selected.size === 1 ? "produto selecionado" : "produtos selecionados"}
            </p>
            <div className="flex gap-2">
              <button type="button" className={buttonClass("outline")} onClick={() => setSelected(new Set())}>
                Limpar seleção
              </button>
              <Link href={`/promocoes/nova?ids=${[...selected].join(",")}`} className={buttonClass("outline")}>
                Agendar promoção
              </Link>
              <Link href={`/lote/novo?ids=${[...selected].join(",")}`} className={buttonClass("primary")}>
                Ações em lote
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
