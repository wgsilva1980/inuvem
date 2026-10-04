"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import type { ProductDetail } from "@/lib/catalog/query";
import { saveVariant, type ActionState } from "./media-actions";
import { fieldClass } from "@/components/ui/field";

const ptMoney = (value: string | null) => (value === null ? "" : Number(value).toFixed(2).replace(".", ","));

type Variant = ProductDetail["variants"][number];

function VariantRow({ productId, variant, images }: { productId: number; variant: Variant; images: ImageRow[] }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(saveVariant.bind(null, productId, Number(variant.id)), null);
  const err = (name: string) => state?.fieldErrors?.[name];
  const label = variant.values.map((x) => Object.values(x)[0]).filter(Boolean).join(" / ") || "Padrão";
  // `key` recria o formulário com os valores novos quando o espelho muda (conflito ou salvamento).
  const key = `${variant.sku}|${variant.price}|${variant.promotional_price}|${variant.stock}|${variant.stock_management}|${variant.image_id}`;

  return (
    <form key={key} action={action} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">SKU</span>
          <input name="sku" defaultValue={variant.sku ?? ""} maxLength={255} className={fieldClass} />
          {err("sku") && <span className="text-danger">{err("sku")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Preço (R$)</span>
          <input name="price" defaultValue={ptMoney(variant.price)} inputMode="decimal" required className={fieldClass} />
          {err("price") && <span className="text-danger">{err("price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Promocional (R$)</span>
          <input name="promotional_price" defaultValue={ptMoney(variant.promotional_price)} inputMode="decimal" className={fieldClass} />
          {err("promotional_price") && <span className="text-danger">{err("promotional_price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Estoque</span>
          <input name="stock" defaultValue={variant.stock_management ? String(variant.stock ?? "") : ""} inputMode="numeric" className={fieldClass} />
          {err("stock") && <span className="text-danger">{err("stock")}</span>}
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="stock_management" defaultChecked={variant.stock_management} />
          <span>Controlar estoque</span>
        </label>
      </div>
      {images.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-muted">Foto da variação</legend>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input type="radio" name="image_id" value="" defaultChecked={variant.image_id === null} className="peer sr-only" />
              <span className="flex size-14 items-center justify-center rounded border border-border text-center text-xs text-muted peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:ring-2">
                Nenhuma
              </span>
            </label>
            {images.map((img, i) => (
              <label key={img.id} className="cursor-pointer">
                <input type="radio" name="image_id" value={img.id} defaultChecked={variant.image_id === img.id} className="peer sr-only" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt={img.alt || `Imagem ${i + 1}`}
                  loading="lazy"
                  className="size-14 rounded border border-border object-cover peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:ring-2"
                />
              </label>
            ))}
          </div>
          {err("image_id") && <span className="text-sm text-danger">{err("image_id")}</span>}
        </fieldset>
      )}
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

export function VariantsEditor({ productId, variants, images }: { productId: number; variants: Variant[]; images: ImageRow[] }) {
  return (
    <Card>
      <h2 className="text-base font-semibold">Variantes</h2>
      <p className="mt-1 text-sm text-muted">
        Cada variante é salva separadamente na Nuvemshop. Sem controle de estoque, a quantidade é ilimitada.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {variants.map((v) => (
          <VariantRow key={v.id} productId={productId} variant={v} images={images} />
        ))}
      </div>
    </Card>
  );
}
