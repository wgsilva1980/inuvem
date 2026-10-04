"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CatalogItem } from "@/lib/catalog/query";

const brl = (value: string | null) => (value === null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const priceRange = (min: string | null, max: string | null) => (min === max ? brl(min) : `${brl(min)} – ${brl(max)}`);

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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Selecionar todos desta página" />
          <span>Selecionar página</span>
        </label>
        {selected.size > 0 && (
          <Link href={`/lote/novo?ids=${[...selected].join(",")}`} className={buttonClass("primary", "min-h-8 px-3 py-1")}>
            Ações em lote ({selected.size} {selected.size === 1 ? "produto" : "produtos"})
          </Link>
        )}
        {total > 0 && (
          <Link href={`/lote/novo${filterQuery ? `?${filterQuery}` : ""}`} className="text-muted underline hover:text-foreground">
            Aplicar a todos os {total} {total === 1 ? "resultado" : "resultados"} do filtro
          </Link>
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
              <li key={p.id} className="flex items-center gap-3 pl-4">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Selecionar ${p.name}`} />
                <Link href={`/produtos/${p.id}`} className="flex min-w-0 flex-1 flex-col gap-1 p-4 pl-0 hover:bg-border/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted">
                      {p.categories.map((c) => c.name).join(", ") || "Sem categoria"} · {p.variant_count} {p.variant_count === 1 ? "variante" : "variantes"} · {p.image_count} {p.image_count === 1 ? "imagem" : "imagens"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <span>{priceRange(p.price_min, p.price_max)}</span>
                    <span className="text-muted">Estoque: {p.stock_total ?? "—"}</span>
                    <Badge tone={p.published ? "success" : "neutral"}>{p.published ? "Publicado" : "Não publicado"}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
