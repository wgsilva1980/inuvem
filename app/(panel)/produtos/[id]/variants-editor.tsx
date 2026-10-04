"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ProductDetail } from "@/lib/catalog/query";
import { saveVariant, type ActionState } from "./media-actions";

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

const ptMoney = (value: string | null) => (value === null ? "" : Number(value).toFixed(2).replace(".", ","));

type Variant = ProductDetail["variants"][number];

function VariantRow({ productId, variant }: { productId: number; variant: Variant }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(saveVariant.bind(null, productId, Number(variant.id)), null);
  const err = (name: string) => state?.fieldErrors?.[name];
  const label = variant.values.map((x) => Object.values(x)[0]).filter(Boolean).join(" / ") || "Padrão";
  // `key` recria o formulário com os valores novos quando o espelho muda (conflito ou salvamento).
  const key = `${variant.sku}|${variant.price}|${variant.promotional_price}|${variant.stock}|${variant.stock_management}`;

  return (
    <form key={key} action={action} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">SKU</span>
          <input name="sku" defaultValue={variant.sku ?? ""} maxLength={255} className={field} />
          {err("sku") && <span className="text-danger">{err("sku")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Preço (R$)</span>
          <input name="price" defaultValue={ptMoney(variant.price)} inputMode="decimal" required className={field} />
          {err("price") && <span className="text-danger">{err("price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Promocional (R$)</span>
          <input name="promotional_price" defaultValue={ptMoney(variant.promotional_price)} inputMode="decimal" className={field} />
          {err("promotional_price") && <span className="text-danger">{err("promotional_price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Estoque</span>
          <input name="stock" defaultValue={variant.stock_management ? String(variant.stock ?? "") : ""} inputMode="numeric" className={field} />
          {err("stock") && <span className="text-danger">{err("stock")}</span>}
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="stock_management" defaultChecked={variant.stock_management} />
          <span>Controlar estoque</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar variante"}
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

export function VariantsEditor({ productId, variants }: { productId: number; variants: Variant[] }) {
  return (
    <Card>
      <h2 className="text-base font-semibold">Variantes</h2>
      <p className="mt-1 text-sm text-muted">
        Cada variante é salva separadamente na Nuvemshop. Sem controle de estoque, a quantidade é ilimitada.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {variants.map((v) => (
          <VariantRow key={v.id} productId={productId} variant={v} />
        ))}
      </div>
    </Card>
  );
}
